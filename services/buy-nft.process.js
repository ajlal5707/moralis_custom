require('dotenv').config();
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const commonService = require('./common.service');
const { convertWeiIntoPrice } = require('../common/helpers');
const auctionService = require('./auction.service');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  MARKET_STATUS,
  AUCTION_SESSION_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`updateBuyNftData: ${txHash}, network = ${networks[0].id}`);
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
        contractInstance.getPastEvents('Buy', {
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
        const { _itemId, _paymentToken, _paymentAmount } = returnValues;

        const network = commonService.getNetworkToken(_paymentToken, networks);
        const input = {
          orderId: Number(_itemId),
          quantity: 1,
          token: network.networkTokenName,
          amount: Number(
            convertWeiIntoPrice(_paymentAmount, network.networkTokenDecimal)
          ),
        };

        let [user, saleInfo] = await Promise.all([
          getUserIdFromAddress(address, db),
          getSaleInfo(input.orderId, network.id, db),
        ]);

        if (
          !saleInfo ||
          saleInfo[0].quantity === saleInfo[0].success_quantity
        ) {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalBuyNft'
          );
          await db.commit();
          return;
        }

        if (events.length > 0) {
          const saleNft = await addNewSaleNft(
            saleInfo[0],
            input,
            user.id,
            db,
            txHash,
            network.networkTokenId
          );

          await Promise.all([
            updateSuccessBuyNft(saleNft, db, saleInfo[0], txHash, network.id),
            updateNftData(saleNft, db),
            commonService.updateSuccessExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            ),
            auctionService.updateAuctionStatusByNftId(
              saleNft.nftId,
              AUCTION_SESSION_STATUS.DONE,
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
            'externalBuyNft'
          );
        } else {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalBuyNft'
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
        'externalBuyNft'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateBuyNftData::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

async function addNewSaleNft(
  putSaleInfo,
  input,
  fromUserId,
  db,
  txHash,
  networkTokenId,
  status = SALE_NFT_STATUS.SUCCESS
) {
  const toUserId = putSaleInfo.from_user_id;
  const price = input.amount / input.quantity;

  const data = {
    id: null,
    nftId: putSaleInfo.nft_id,
    fromUserId: fromUserId,
    toUserId: toUserId,
    price: price,
    quantity: input.quantity,
    orderId: putSaleInfo.order_id,
    originalPrice: putSaleInfo.original_price,
  };
  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, order_id, tx_id, original_price, network_token_id, parent_id) values
            (${data.nftId}, ${fromUserId}, ${toUserId}, ${data.price}, ${input.quantity}, ${SALE_NFT_ACTION.BUY_NFT}, '${input.token}', ${status}, ${data.orderId},'${txHash}', ${data.originalPrice}, ${networkTokenId}, ${putSaleInfo.id})`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

async function updateNftData(data, db) {
  let [nft, isSaleStatus] = await Promise.all([
    commonService.getNftById(data.nftId, db),
    isSaleByNftId(data.nftId, db),
  ]);
  let onSaleStatus = isSaleStatus ? 1 : 0;
  let countQuantity = Number(nft.quantity) - Number(data.quantity);
  let price = Number(nft.price);
  let market = nft.market;
  let type = nft.type;
  let { minPriceSaleNft, receiveTokenSaleNft } =
    await commonService.getMinPutOnSale(data.nftId, db);
  if (minPriceSaleNft) {
    price = Number(minPriceSaleNft);
  }
  if (type === 2) {
    countQuantity = nft.quantity;
  }

  await commonService.updateNft(
    data.nftId,
    type,
    onSaleStatus,
    market,
    price,
    receiveTokenSaleNft,
    db,
    MARKET_STATUS.NOT_ON_SALE
  );
}

async function isSaleByNftId(nftId, db) {
  const sql = `SELECT * FROM \`sale_nft\` WHERE nft_id = ${nftId} AND action = ${SALE_NFT_ACTION.PUT_ON_SALE} AND status = ${SALE_NFT_STATUS.SUCCESS} ORDER BY id desc LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return false;
  return true;
}

async function updateSuccessBuyNft(data, db, saleInfo, txHash, networkId) {
  let status = SALE_NFT_STATUS.NOT_COUNT;
  const sql1 = `UPDATE \`sale_nft\` set success_quantity = 1, status = ${status} where id = ${saleInfo.id}`;
  await db.query(sql1);
  if (data.fromUserId) {
    let buyerOwnerNft = await commonService.getOwnerNft(
      data.nftId,
      data.fromUserId,
      db
    );
    if (buyerOwnerNft.length === 0) {
      await commonService.newOwnerNft(
        data.nftId,
        data.fromUserId,
        data.quantity,
        db
      );
    } else {
      await commonService.updateOwnerNft(buyerOwnerNft[0], data.quantity, db);
    }
  }
  let sellerOwnerNft = await commonService.getOwnerNft(
    data.nftId,
    data.toUserId,
    db
  );
  if (sellerOwnerNft.length > 0) {
    await commonService.updateOwnerNft(sellerOwnerNft[0], -data.quantity, db);
  }
}

async function getSaleInfo(orderId, networkId, db) {
  const sqlGetTypeNft = `SELECT sn.*, nfts.\`standard_type\` AS NftType FROM \`sale_nft\` sn JOIN nfts ON sn.nft_id = nfts.id WHERE sn.order_id = '${orderId}' AND sn.action = ${SALE_NFT_ACTION.PUT_ON_SALE} AND sn.status = ${SALE_NFT_STATUS.SUCCESS} AND nfts.network_id = '${networkId}' ORDER BY sn.id DESC LIMIT 1`;
  const [result] = await db.query(sqlGetTypeNft);
  if (result.length === 0) return null;

  return result;
}

async function getUserIdFromAddress(address, db) {
  const sql = `SELECT u.id from users u join \`user-wallet\` uw on u.user_wallet_id = uw.id where uw.address LIKE '${address}'`;
  const [result] = await db.query(sql);
  if (result.length === 0) {
    return { id: null, profileId: null };
  }
  return { id: result[0].id };
}

module.exports = {
  run,
};
