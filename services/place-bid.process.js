require('dotenv').config();
const socket = require('./socket.service');
const commonService = require('./common.service');
const auctionService = require('./auction.service');
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const {
  convertWeiIntoPrice,
  convertTotalPriceToOriginalPrice,
} = require('../common/helpers');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  NFT_STANDARD_TYPE,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`updatePlaceBidData: ${txHash}`);
  const web3 = commonService.getInstanceWeb3(networks[0]);
  const receipt = await web3.eth.getTransactionReceipt(txHash);
  if (receipt) {
    await synsData(receipt, address, txHash, networks, web3, db);
  } else {
    console.log(
      `Can't get receipt :: txHash :: ${txHash} :: network :: ${networks[0].name}`
    );
  }
}

async function synsData(receipt, address, txHash, networks, web3, db) {
  await db.beginTransaction();
  try {
    const checkTx = await commonService.checkTxIdExistedInSaleNft(txHash, db);

    if (!checkTx) {
      const contractInstance = new web3.eth.Contract(
        XANALIA_DEX_ABI,
        networks[0].xanalia_dex_contract
      );
      const [events, transaction] = await Promise.all([
        contractInstance.getPastEvents('BidAuctionCreated', {
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        }),
        web3.eth.getTransaction(txHash),
      ]);

      if (transaction.transactionIndex != null && events.length > 0) {
        const currentEvent = events.find(
          (event) => event.transactionHash === txHash
        );
        const { returnValues } = currentEvent;
        const { _bidAuctionId, _tokenId } = returnValues;
        let input = parseInput(transaction.input, networks, web3);

        let [nft, user, networkToken] = await Promise.all([
          commonService.getNftByTokenAndNetwork(
            input.tokenId,
            input.tokenAddress,
            networks[0].id,
            db
          ),
          commonService.getUserIdFromAddress(address, db),
          commonService.getNetworkTokenByContract(input.paymentToken, db),
        ]);

        if (
          !nft ||
          (nft && Number(nft.standard_type) !== NFT_STANDARD_TYPE.ERC_721)
        ) {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalPlaceBidAuction'
          );
          await db.commit();
          return false;
        }

        const arrOwnerNft =
          await commonService.getListAddressOwnerNftNotCurrentUser(
            nft.id,
            user.id,
            db
          );
        if (arrOwnerNft.length === 0) {
          throw new Error(`Place bid auction: NFT ${nft.id} has no owner`);
        }
        const ownerId = arrOwnerNft[0].id;

        const auction =
          await auctionService.getAuctionSessionWithNftIdAndScAuctionId(
            input.auctionId,
            nft.id,
            db
          );

        if (!auction) {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalPlaceBidAuction'
          );
          await db.commit();
          return false;
        }
        input.networkTokenId = networkToken.id;
        input.auctionSessionId = auction.id;
        input.receiveToken = auction.receiveToken;

        if (input.price > auction.highest_price) {
          await auctionService.updateHighestPriceById(auction, input.price, db);
        }

        const [bidNft] = await Promise.all([
          addNewBidNft(
            nft,
            input,
            user.id,
            _tokenId,
            txHash,
            SALE_NFT_STATUS.SUCCESS,
            ownerId,
            _bidAuctionId,
            db
          ),
          commonService.updateSuccessExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          ),
        ]);

        socket.sendToSocket(
          {
            bidNft: bidNft,
            txHash: txHash,
            result: true,
            address: address.toLowerCase(),
          },
          'externalPlaceBidAuction'
        );
      } else {
        console.log(`Transaction: ${txHash} pending`);
      }
    } else {
      await commonService.updateFailExternalTransaction(
        txHash,
        networks[0].moralis_transactions,
        db
      );
      socket.sendToSocket(
        {
          txHash: txHash,
          result: false,
          address: address.toLowerCase(),
        },
        'externalPlaceBidAuction'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updatePlaceBidData::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

function parseInput(input, networks, web3) {
  const array = [
    'address',
    'address',
    'uint256',
    'uint256',
    'uint256',
    'uint256',
  ];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);
  const network = commonService.getNetworkToken(result[1], networks);

  return {
    tokenAddress: result[0],
    paymentToken: result[1],
    tokenId: Number(result[2]),
    auctionId: Number(result[3]),
    price: Number(convertWeiIntoPrice(result[4], network.networkTokenDecimal)),
    expire: Number(result[5]),
    networkTokenId: network.networkTokenId,
    token: network.networkTokenName,
  };
}

async function addNewBidNft(
  nft,
  input,
  userId,
  orderId,
  txHash,
  status = SALE_NFT_STATUS.SUCCESS,
  ownerId,
  bidAuctionId,
  db
) {
  const originalPrice = convertTotalPriceToOriginalPrice(
    input.price,
    nft.royalty,
    nft.platform_commission
  );

  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, expired, order_id, tx_id, original_price, network_token_id, auction_session_id, bid_id) VALUES (
        ${nft.id}, ${userId}, ${ownerId}, ${input.price}, 1,
        ${SALE_NFT_ACTION.BID_NFT}, '${input.token}', ${status},
        ${input.expire}, ${Number(orderId)}, '${txHash}', ${originalPrice},
        ${input.networkTokenId}, ${input.auctionSessionId},
        ${Number(bidAuctionId)})`;

  const [result] = await db.query(sql);
  return {
    id: result.insertId,
  };
}

module.exports = {
  run,
};
