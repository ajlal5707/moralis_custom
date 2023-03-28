require('dotenv').config();
// const MARKET_ABI = require("../abi/market_abi.json");
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const { convertWeiIntoPrice } = require('../common/helpers');
const commonService = require('./common.service');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  MARKET_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`EditOrder: ${txHash}, network = ${networks[0].id}`);
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
        contractInstance.getPastEvents('OrderEdited', {
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
        const { _orderId } = returnValues;

        const [input, user] = await Promise.all([
          parseInput(transaction.input, web3, db),
          commonService.getUserIdFromAddress(address, db),
        ]);
        const saleInfo = await getSaleInfo(
          input.orderId,
          user.id,
          networks[0].id,
          db
        );

        const network = commonService.getNetworkTokenByReceiveToken(
          saleInfo.receive_token,
          networks
        );

        input.price = Number(
          convertWeiIntoPrice(input.price, network.networkTokenDecimal)
        );

        if (!saleInfo) {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalEditOrder'
          );
          await db.commit();
          return;
        }

        if (currentEvent) {
          await Promise.all([
            updateSuccessSaleNft(db, saleInfo),
            addNewSaleNft(
              saleInfo.nft_id,
              input,
              saleInfo.from_user_id,
              db,
              _orderId,
              txHash,
              saleInfo.status,
              saleInfo.receive_token,
              saleInfo.network_token_id,
              saleInfo.id
            ),
            updateNftData(input, saleInfo, db),
            commonService.updateSuccessExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            ),
          ]);
          socket.sendToSocket(
            {
              saleInfo: saleInfo,
              txHash: txHash,
              result: true,
              address: address.toLowerCase(),
            },
            'externalEditOrder'
          );
        } else {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            {
              saleInfo: saleInfo,
              txHash: txHash,
              result: false,
              address: address.toLowerCase(),
            },
            'externalEditOrder'
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
        'externalEditOrder'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateRemoveSaleData::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

async function getSaleInfo(orderId, userId, networkId, db) {
  const sqlGetTypeNft = `SELECT sn.*, nfts.\`standard_type\` AS NftType FROM \`sale_nft\` sn JOIN nfts ON sn.nft_id = nfts.id WHERE nfts.network_id = '${networkId}' AND sn.order_id = '${orderId}' AND sn.from_user_id = ${userId} AND sn.action = ${SALE_NFT_ACTION.PUT_ON_SALE} AND sn.status = ${SALE_NFT_STATUS.SUCCESS} ORDER BY sn.id DESC LIMIT 1`;
  const [result] = await db.query(sqlGetTypeNft);
  if (result.length === 0) return null;
  return result[0];
}

async function updateSuccessSaleNft(db, saleInfo) {
  let sql = `UPDATE \`sale_nft\` SET status = ${SALE_NFT_STATUS.NOT_COUNT} WHERE id = ${saleInfo.id} AND nft_id = ${saleInfo.nft_id} AND status = ${SALE_NFT_STATUS.SUCCESS}`;
  await db.query(sql);
}
async function addNewSaleNft(
  nft,
  input,
  userId,
  db,
  orderId,
  txHash,
  status = SALE_NFT_STATUS.SUCCESS,
  receiveToken,
  networkTokenId,
  saleInfoId
) {
  const originalPrice = input.price;
  const data = {
    id: null,
    nftId: nft,
    fromUserId: userId,
    toUserId: userId,
    price: input.price,
    orderId: input.orderId,
    originalPrice,
    receiveToken,
    networkTokenId,
  };
  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, status, order_id, tx_id, original_price, receive_token, network_token_id, parent_id) values 
            (${data.nftId},${userId}, ${userId}, ${data.price}, 1, ${SALE_NFT_ACTION.PUT_ON_SALE}, ${status}, ${orderId}, '${txHash}', ${originalPrice}, '${receiveToken}', ${networkTokenId}, ${saleInfoId})`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

async function parseInput(input, web3, db) {
  const array = ['uint256', 'uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);
  return {
    orderId: Number(result[0]),
    price: result[1],
  };
}

async function updateNftData(input, data, db) {
  let [nft, countQuantity] = await Promise.all([
    commonService.getNftById(data.nft_id, db),
    commonService.getRemainingQuantity(data.nft_id, db),
  ]);
  let price = input.price;
  let receiveToken = nft.receive_token;
  let market = nft.market;
  let type = nft.type;
  let onSaleStatus = nft.on_sale_status;

  if (nft.type == 2) {
    countQuantity = nft.quantity;
  }

  if (countQuantity == 0) {
    onSaleStatus = 0;
  } else {
    onSaleStatus = 1;
  }

  await commonService.updateNft(
    data.nft_id,
    type,
    onSaleStatus,
    market,
    price,
    receiveToken,
    db,
    MARKET_STATUS.ON_FIX_PRICE
  );
}

module.exports = {
  run,
};
