require('dotenv').config();
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const commonService = require('./common.service');
const auctionService = require('./auction.service');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  MARKET_STATUS,
  AUCTION_SESSION_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`updateAcceptOfferData: ${txHash}, network = ${networks[0].id}`);
  const web3 = commonService.getInstanceWeb3(networks[0]);
  let receipt = await web3.eth.getTransactionReceipt(txHash);
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
    const contractInstance = new web3.eth.Contract(
      XANALIA_DEX_ABI,
      networks[0].xanalia_dex_contract
    );
    const events = await contractInstance.getPastEvents('AcceptOffer', {
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    let checkTx = await commonService.checkTxIdExistedInSaleNft(txHash, db);

    if (!checkTx) {
      let transaction = await web3.eth.getTransaction(txHash);

      if (transaction.transactionIndex != null && events.length > 0) {
        const input = parseInput(transaction.input, web3);
        let [user, makeOfferInfo] = await Promise.all([
          commonService.getUserIdFromAddress(address, db),
          getSaleInfo(input.bidId, networks[0].id, db),
        ]);

        if (
          !makeOfferInfo ||
          makeOfferInfo.quantity === makeOfferInfo.successQuantity
        ) {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalAcceptSuccess'
          );
          await db.commit();
          return false;
        }

        const currentEvent = events.find(
          (event) => event.transactionHash === txHash
        );

        if (currentEvent) {
          const network = getNetworkByReceiveToken(
            makeOfferInfo.receive_token,
            networks
          );
          let saleNft = await addNewSaleNft(
            makeOfferInfo,
            user.id,
            db,
            txHash,
            network.networkTokenId
          );

          await Promise.all([
            updateSuccessAcceptNft(
              saleNft,
              db,
              makeOfferInfo,
              user,
              input.orderId
            ),
            updateNftData(saleNft, db),
            auctionService.updateAuctionStatusByNftId(
              saleNft.nftId,
              AUCTION_SESSION_STATUS.DONE,
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
              saleNft: saleNft,
              txHash: txHash,
              result: true,
              address: address.toLowerCase(),
            },
            'externalAcceptSuccess'
          );
          await sendSocketEvent(saleNft, db);
        } else {
          await Promise.all([
            addNewSaleNft(
              makeOfferInfo,
              user.id,
              db,
              txHash,
              network.networkTokenId,
              SALE_NFT_STATUS.FAIL
            ),
            commonService.updateFailExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            ),
          ]);
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalAcceptSuccess'
          );
        }
      } else {
        console.log(`transaction: ${txHash} pending`);
      }
    } else {
      await commonService.updateFailExternalTransaction(
        txHash,
        networks[0].moralis_transactions,
        db
      );
      socket.sendToSocket(
        { txHash: txHash, result: false, address: address.toLowerCase() },
        'externalAcceptSuccess'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateAcceptOfferData::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

function getNetworkByReceiveToken(receiveToken, networks) {
  const network = networks.find(
    (network) => receiveToken === network.networkTokenName
  );
  if (network) {
    return network;
  }
  throw `Not found receiveToken of receiveToken = ${receiveToken} with network = ${networks[0].id}`;
}

async function addNewSaleNft(
  makeOfferInfo,
  fromUserId,
  db,
  txHash,
  networkTokenId,
  status = SALE_NFT_STATUS.SUCCESS
) {
  const toUserId = makeOfferInfo.from_user_id;

  const data = {
    id: null,
    nftId: makeOfferInfo.nft_id,
    fromUserId: fromUserId,
    toUserId: toUserId,
    price: makeOfferInfo.price,
    quantity: makeOfferInfo.quantity,
    orderId: makeOfferInfo.order_id,
    originalPrice: makeOfferInfo.original_price,
  };
  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, order_id, tx_id, original_price, network_token_id, parent_id) values
        (${data.nftId}, ${fromUserId}, ${toUserId}, ${data.price}, ${data.quantity}, ${SALE_NFT_ACTION.ACCEPT_NFT}, '${makeOfferInfo.receive_token}', ${status}, ${data.orderId}, '${txHash}', ${data.originalPrice}, ${networkTokenId}, ${makeOfferInfo.id})`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

async function sendSocketEvent(data, db) {
  let [addressOwner, addressToUser] = await Promise.all([
    commonService.getUserAddressFromId(data.fromUserId, db),
    commonService.getUserAddressFromId(data.toUserId, db),
  ]);
  let dataSocketOwner = socket.createSocketData(
    data.toUserId,
    data.fromUserId,
    'nft/accept-success',
    data.nftId,
    data.id,
    [addressOwner]
  );
  let dataSocketToUser = socket.createSocketData(
    data.fromUserId,
    data.toUserId,
    'nft/accept',
    data.nftId,
    data.id,
    [addressToUser]
  );
  await Promise.all([
    socket.sendToSocket(dataSocketOwner, 'nft/accept-success'),
    socket.sendToSocket(dataSocketToUser, 'nft/accept'),
  ]);
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

async function updateSuccessAcceptNft(data, db, saleInfo, user, orderId) {
  let quantity = data.quantity;
  let status = SALE_NFT_STATUS.SUCCESS;

  if (saleInfo.quantity - quantity === saleInfo.success_quantity) {
    status = SALE_NFT_STATUS.NOT_COUNT;
  }

  let p = [];
  const sql1 = `UPDATE \`sale_nft\` set success_quantity = ${
    saleInfo.success_quantity + quantity
  }, status = ${status} where id = ${saleInfo.id}`;
  p.push(db.query(sql1));

  const sql2 = `SELECT * from \`sale_nft\` where nft_id=${saleInfo.nft_id} and action = ${SALE_NFT_ACTION.PUT_ON_SALE} and status = ${SALE_NFT_STATUS.SUCCESS} and from_user_id = ${user.id} AND order_id IN (${orderId})`;
  let [putOnSaleUpdate] = await db.query(sql2);

  putOnSaleUpdate.forEach((putSale) => {
    let quantitySaleRemaining = putSale.quantity - putSale.success_quantity;
    quantity -= quantitySaleRemaining;
    if (quantity >= 0) {
      p.push(
        db.query(
          `UPDATE \`sale_nft\` set success_quantity = ${
            putSale.success_quantity + quantitySaleRemaining
          }, status = ${SALE_NFT_STATUS.NOT_COUNT} where id = ${putSale.id}`
        )
      );
    } else {
      p.push(
        db.query(
          `UPDATE \`sale_nft\` set success_quantity = ${
            putSale.success_quantity + quantity + quantitySaleRemaining
          }, status = ${SALE_NFT_STATUS.SUCCESS} where id = ${putSale.id}`
        )
      );
    }
  });

  const sql4 = `UPDATE \`sale_nft\` SET to_user_id = ${data.toUserId} where nft_id=${saleInfo.nft_id} and action = ${SALE_NFT_ACTION.MAKE_OFFER} and status = ${SALE_NFT_STATUS.SUCCESS} and success_quantity = 0 `;
  p.push(db.query(sql4));
  await Promise.all(p);

  const [sellerOwnerNft, buyerOwnerNft] = await Promise.all([
    commonService.getOwnerNft(data.nftId, data.fromUserId, db),
    commonService.getOwnerNft(data.nftId, data.toUserId, db),
  ]);

  await commonService.updateOwnerNft(sellerOwnerNft[0], -data.quantity, db);

  if (buyerOwnerNft.length > 0) {
    await commonService.updateOwnerNft(buyerOwnerNft[0], data.quantity, db);
  } else {
    await commonService.newOwnerNft(
      data.nftId,
      data.toUserId,
      data.quantity,
      db
    );
  }
}

async function getSaleInfo(orderId, networkId, db) {
  const sql = `SELECT sn.* FROM \`sale_nft\` AS sn JOIN nfts ON nfts.id = sn.nft_id WHERE nfts.network_id = ${networkId} AND sn.action = ${SALE_NFT_ACTION.MAKE_OFFER} AND sn.order_id = ${orderId} AND sn.status = ${SALE_NFT_STATUS.SUCCESS} ORDER BY sn.id desc LIMIT 1`;
  const [result] = await db.query(sql);
  return result[0];
}

function parseInput(input, web3) {
  const array = ['uint256', 'uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);

  return {
    bidId: Number(result[0]),
    orderId: Number(result[1]),
  };
}

module.exports = {
  run,
};
