require('dotenv').config();
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const {
  convertWeiIntoPrice,
  convertTotalPriceToOriginalPrice,
} = require('../common/helpers');
const commonService = require('./common.service');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  NFT_STANDARD_TYPE,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`updateMakeOfferData: ${txHash}, networkId=${networks[0].id}`);
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
        contractInstance.getPastEvents('OfferCreated', {
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
        const _bidId = returnValues._offerId;
        const input = parseInput(transaction.input, networks, web3);

        let [nft, user] = await Promise.all([
          commonService.getNftByTokenAndNetwork(
            input.tokenId,
            input.tokenAddress,
            networks[0].id,
            db
          ),
          getUserIdFromAddress(address, db),
        ]);

        if (!nft || nft.standard_type !== NFT_STANDARD_TYPE.ERC_721) {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalMakeOffer'
          );
          await db.commit();
          return false;
        }

        const arrOwnerNft = await commonService.getListAddressOwnerNft(
          nft.id,
          db
        );
        if (arrOwnerNft.length === 0) {
          throw new Error(`Make offer: NFT ${nft.id} has no owner`);
        }
        const ownerId = arrOwnerNft[0].id;

        if (events.length > 0) {
          const saleNft = await addNewSaleNft(
            nft,
            input,
            user.id,
            db,
            _bidId,
            txHash,
            input.networkTokenId,
            SALE_NFT_STATUS.SUCCESS,
            ownerId
          );
          await commonService.updateSuccessExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            {
              saleNft: saleNft,
              txHash: txHash,
              result: true,
              address: address.toLowerCase(),
            },
            'externalMakeOffer'
          );
        } else {
          const [saleNft] = await Promise.all([
            addNewSaleNft(
              nft,
              input,
              user.id,
              db,
              _bidId,
              txHash,
              input.networkTokenId,
              SALE_NFT_STATUS.FAIL,
              ownerId
            ),
            commonService.updateFailExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            ),
          ]);
          socket.sendToSocket(
            {
              saleNft: saleNft,
              txHash: txHash,
              result: false,
              address: address.toLowerCase(),
            },
            'externalMakeOffer'
          );
        }
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
        { txHash: txHash, result: false, address: address.toLowerCase() },
        'externalMakeOffer'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateMakeOfferData::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

async function addNewSaleNft(
  nft,
  input,
  userId,
  db,
  orderId,
  txHash,
  networkTokenId,
  status = SALE_NFT_STATUS.SUCCESS,
  ownerId
) {
  const originalPrice = convertTotalPriceToOriginalPrice(
    input.price,
    nft.royalty,
    nft.platform_commission
  );

  const data = {
    id: null,
    nftId: nft.id,
    fromUserId: userId,
    toUserId: ownerId,
    price: input.price,
    quantity: input.quantity,
    orderId: orderId,
    originalPrice,
  };
  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, expired, order_id, tx_id, original_price, network_token_id) values 
            (${data.nftId}, ${userId}, ${ownerId}, ${data.price}, ${input.quantity}, ${SALE_NFT_ACTION.MAKE_OFFER}, '${input.token}', ${status}, ${input.expire}, ${orderId}, '${txHash}', ${originalPrice}, ${networkTokenId})`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

function parseInput(input, networks, web3) {
  const array = ['address', 'address', 'uint256', 'uint256', 'uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);
  const network = commonService.getNetworkToken(result[1], networks);

  return {
    tokenAddress: result[0],
    token: network.networkTokenName,
    tokenId: Number(result[2]),
    quantity: 1,
    price: Number(convertWeiIntoPrice(result[3], network.networkTokenDecimal)),
    expire: Number(result[4]),
    networkTokenId: network.networkTokenId,
  };
}

async function getUserIdFromAddress(address, db) {
  const sql = `SELECT u.id from users u join \`user-wallet\` uw on u.user_wallet_id = uw.id where uw.address LIKE '${address}'`;
  const [result] = await db.query(sql);
  return { id: result[0].id };
}

module.exports = {
  run,
};
