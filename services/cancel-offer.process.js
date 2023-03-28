require('dotenv').config();
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const commonService = require('./common.service');
const { SALE_NFT_ACTION, SALE_NFT_STATUS } = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`updateRemoveBidData: ${txHash}, network = ${networks[0].id}`);
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
        contractInstance.getPastEvents('OfferCancelled', {
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        }),
        web3.eth.getTransaction(txHash),
      ]);

      if (transaction.transactionIndex != null && events.length > 0) {
        const input = parseInput(transaction.input, web3);
        const [user, saleInfo] = await Promise.all([
          commonService.getUserIdFromAddress(address, db),
          getSaleInfo(input, networks[0].id, db),
        ]);
        if (!saleInfo) {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalRemoveBid'
          );
          await db.commit();
          return;
        }
        const currentEvent = events.find(
          (event) => event.transactionHash === txHash
        );
        const ownerId = saleInfo.to_user_id;

        const network = getNetworkByReceiveToken(
          saleInfo.receive_token,
          networks
        );

        if (currentEvent) {
          let saleNft = await addNewSaleNft(
            saleInfo,
            input,
            user.id,
            txHash,
            network.networkTokenId,
            db,
            SALE_NFT_STATUS.SUCCESS,
            ownerId
          );
          await Promise.all([
            updateSuccessSaleNft(db, saleNft, txHash, saleInfo),
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
            'externalRemoveBid'
          );
        } else {
          const [saleNft] = await Promise.all([
            addNewSaleNft(
              saleInfo,
              input,
              user.id,
              txHash,
              network.networkTokenId,
              db,
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
            'externalRemoveBid'
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
        { txHash: txHash, result: false },
        'externalRemoveBid'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateRemoveBidData::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

async function getSaleInfo(orderId, networkId, db) {
  const sql = `SELECT sn.* FROM \`sale_nft\` AS sn JOIN nfts ON nfts.id = sn.nft_id where nfts.network_id = '${networkId}' AND sn.action = ${SALE_NFT_ACTION.MAKE_OFFER} and sn.order_id = '${orderId}' and sn.status in (${SALE_NFT_STATUS.SUCCESS},${SALE_NFT_STATUS.MAKE_OFFER_EXPIRED}) order by sn.id desc limit 1`;
  const [result] = await db.query(sql);
  return result[0];
}

async function addNewSaleNft(
  saleInfo,
  input,
  userId,
  txHash,
  networkTokenId,
  db,
  status = SALE_NFT_STATUS.SUCCESS,
  ownerId
) {
  const action =
    Number(saleInfo.status) === SALE_NFT_STATUS.MAKE_OFFER_EXPIRED
      ? SALE_NFT_ACTION.RECLAIM_MAKE_OFFER
      : SALE_NFT_ACTION.CANCEL_MAKE_OFFER;
  const data = {
    id: null,
    nftId: saleInfo.nft_id,
    fromUserId: userId,
    toUserId: ownerId,
    orderId: input,
    quantity: saleInfo.quantity,
    receiveToken: saleInfo.receive_token,
    price: saleInfo.price,
    originalPrice: saleInfo.original_price,
  };
  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, order_id, tx_id, original_price, network_token_id, parent_id) values 
        (${data.nftId}, ${userId}, ${ownerId}, ${data.price}, ${data.quantity}, ${action}, '${data.receiveToken}', ${status}, ${data.orderId}, '${txHash}', ${data.originalPrice}, ${networkTokenId}, ${saleInfo.id})`;
  const [result] = await db.query(sql);
  console.log('add new sale inserted result:', result);
  data.id = result.insertId;
  return data;
}

async function updateSuccessSaleNft(db, saleInfo, txHash) {
  let sql = `UPDATE \`sale_nft\` set status = ${SALE_NFT_STATUS.NOT_COUNT} where nft_id = '${saleInfo.nftId}' and order_id=${saleInfo.orderId} and action = ${SALE_NFT_ACTION.MAKE_OFFER} and status IN (${SALE_NFT_STATUS.SUCCESS},${SALE_NFT_STATUS.MAKE_OFFER_EXPIRED})`;

  await db.query(sql);
}

function parseInput(input, web3) {
  const type = 'uint256';
  input = input.slice(10, input.length);
  return web3.eth.abi.decodeParameter(type, input);
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

module.exports = {
  run,
};
