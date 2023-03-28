require('dotenv').config();
// const MARKET_ABI = require("../abi/market_abi.json");
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const commonService = require('./common.service');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  MARKET_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`updateRemoveSaleData: ${txHash}, network = ${networks[0].id}`);
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
        contractInstance.getPastEvents('OrderCancelled', {
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        }),
        web3.eth.getTransaction(txHash),
      ]);
      if (transaction.transactionIndex != null && events.length > 0) {
        let input = parseInput(transaction.input, web3);
        let [user, saleInfo] = await Promise.all([
          commonService.getUserIdFromAddress(address, db),
          getSaleInfo(input.orderId, networks[0].id, db),
        ]);
        if (!saleInfo) {
          console.log('Not found SaleInfo');
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalRemoveSale'
          );
          await db.commit();
          return false;
        }

        const currentEvent = events.find(
          (event) => event.transactionHash === txHash
        );
        if (currentEvent) {
          const saleNft = await addNewSaleNft(
            saleInfo,
            input.orderId,
            user.id,
            txHash,
            db
          );
          await Promise.all([
            updateSuccessSaleNft(db, saleNft),
            updateNftData(saleNft, db, user),
            commonService.updateSuccessExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            ),
          ]);

          socket.sendToSocket(
            {
              saleNft: saleNft,
              txHash: txHash,
              result: true,
              address: address.toLowerCase(),
            },
            'externalRemoveSale'
          );
        } else {
          let saleNft = await addNewSaleNft(
            saleInfo,
            input.orderId,
            user.id,
            txHash,
            db,
            SALE_NFT_STATUS.FAIL
          );
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            {
              saleNft: saleNft,
              txHash: txHash,
              result: false,
              address: address.toLowerCase(),
            },
            'externalRemoveSale'
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
        'externalRemoveSale'
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

async function getSaleInfo(orderId, networkId, db) {
  const sqlGetTypeNft = `SELECT sn.*, nfts.\`standard_type\` AS NftType FROM \`sale_nft\` sn JOIN nfts ON sn.nft_id = nfts.id WHERE nfts.network_id = '${networkId}' AND sn.order_id = '${orderId}' AND sn.action = ${SALE_NFT_ACTION.PUT_ON_SALE} AND sn.status = ${SALE_NFT_STATUS.SUCCESS} ORDER BY sn.id DESC LIMIT 1`;
  const [result] = await db.query(sqlGetTypeNft);
  if (result.length === 0) return null;
  return result[0];
}

async function addNewSaleNft(
  saleInfo,
  orderId,
  userId,
  txHash,
  db,
  status = SALE_NFT_STATUS.SUCCESS
) {
  const data = {
    id: null,
    nftId: saleInfo.nft_id,
    fromUserId: userId,
    toUserId: userId,
    orderId,
    quantity: saleInfo.quantity,
  };
  const sql = `INSERT INTO \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, status, order_id, tx_id, parent_id) values 
        (${data.nftId}, ${userId}, ${userId}, 0, ${data.quantity}, ${SALE_NFT_ACTION.CANCEL_SALE_NFT}, ${status}, ${data.orderId}, '${txHash}', ${saleInfo.id})`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

async function updateSuccessSaleNft(db, saleInfo) {
  let sql = `UPDATE \`sale_nft\` SET status = ${SALE_NFT_STATUS.NOT_COUNT} WHERE nft_id = '${saleInfo.nftId}' AND order_id= ${saleInfo.orderId} AND action = ${SALE_NFT_ACTION.PUT_ON_SALE} AND status = ${SALE_NFT_STATUS.SUCCESS}`;
  await db.query(sql);
}

function parseInput(input, web3) {
  const array = ['uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);

  return {
    orderId: Number(result[0]),
  };
}

async function updateNftData(data, db, user) {
  let [nft, countQuantity] = await Promise.all([
    commonService.getNftById(data.nftId, db),
    commonService.getRemainingQuantity(data.nftId, db),
  ]);

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
    data.nftId,
    type,
    onSaleStatus,
    market,
    0,
    null,
    db,
    MARKET_STATUS.NOT_ON_SALE
  );
}

module.exports = {
  run,
};
