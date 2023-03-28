require('dotenv').config();
const commonService = require('./common.service');
const auctionService = require('./auction.service');
const socket = require('./socket.service');
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
  console.log(`updateEditBidDataAuction: ${txHash}`);
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
        contractInstance.getPastEvents('BidAuctionEdited', {
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
        const { _bidAuctionId } = returnValues;
        const user = await commonService.getUserIdFromAddress(address, db);
        let input = await parseInput(
          transaction.input,
          user.id,
          networks[0].id,
          web3,
          db
        );

        let nft = await commonService.getNftById(input.bidInfo.nft_id, db);

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
            {
              txHash: txHash,
              result: false,
              address: address.toLowerCase(),
            },
            'externalUpdateBid'
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

        input.newBidAuctionId = Number(_bidAuctionId);
        input.txHash = txHash;
        input.ownerId = arrOwnerNft[0].id;
        input.receiveToken = input.networkToken.token_name;

        const [auction] = await Promise.all([
          auctionService.getAuctionSessionById(
            input.bidInfo.auction_session_id,
            db
          ),
          commonService.updateSuccessExternalTransaction(txHash, db),
          updateOldBid(db, input.bidInfo.id),
        ]);

        if (input.price > Number(auction.highest_price)) {
          await auctionService.updateHighestPriceById(auction, input.price, db);
        }

        const bidNft = await addNewBidNft(
          nft,
          input,
          input.bidInfo,
          SALE_NFT_STATUS.SUCCESS,
          db
        );

        socket.sendToSocket(
          {
            bidNft: bidNft,
            txHash: txHash,
            result: true,
            address: address.toLowerCase(),
          },
          'externalUpdateBid'
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
        'externalUpdateBid'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateBidData::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

async function parseInput(input, userId, networkId, web3, db) {
  const array = ['uint256', 'uint256', 'uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);

  const bidInfo = await getBidInfoById(result[0], networkId, userId, db);
  const networkToken = await commonService.getNetworkTokenById(
    bidInfo.network_token_id,
    db
  );

  return {
    bidAuctionId: Number(result[0]),
    price: Number(convertWeiIntoPrice(result[1], networkToken.decimal)),
    expire: Number(result[2]),
    bidInfo: bidInfo,
    networkToken: networkToken,
  };
}

async function getBidInfoById(bidId, networkId, userId, db) {
  const sql = `SELECT sn.* FROM \`sale_nft\` sn JOIN \`nfts\` ON sn.nft_id = nfts.id WHERE sn.from_user_id = ${userId} AND sn.action = ${SALE_NFT_ACTION.BID_NFT} AND sn.bid_id = '${bidId}' AND sn.status = ${SALE_NFT_STATUS.SUCCESS} AND nfts.network_id = ${networkId} ORDER BY sn.id DESC LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function updateOldBid(db, id) {
  const sql = `UPDATE \`sale_nft\` SET action = ${SALE_NFT_ACTION.BID_EDITED} WHERE id = ${id}`;
  await db.query(sql);
}

async function addNewBidNft(
  nft,
  input,
  bidInfo,
  status = SALE_NFT_STATUS.SUCCESS,
  db
) {
  const originalPrice = convertTotalPriceToOriginalPrice(
    input.price,
    nft.royalty,
    nft.platform_commission
  );

  const sql = `
    insert into \`sale_nft\` (
      nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, order_id, tx_id, original_price, network_token_id, auction_session_id, bid_id, parent_id
    ) VALUES (
      ${bidInfo.nft_id}, ${bidInfo.from_user_id}, ${bidInfo.to_user_id}, ${input.price}, 1, ${SALE_NFT_ACTION.BID_NFT}, '${bidInfo.receive_token}', ${status},
      ${bidInfo.order_id}, '${input.txHash}', ${originalPrice},  ${bidInfo.network_token_id}, ${bidInfo.auction_session_id}, ${input.newBidAuctionId}, ${bidInfo.id}
    )
	`;

  const [result] = await db.query(sql);
  const data = {
    id: result.insertId,
  };
  return data;
}

module.exports = {
  run,
};
