require('dotenv').config();
const commonService = require('./common.service');
const auctionService = require('./auction.service');
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  AUCTION_SESSION_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`updateCancelBidData: ${txHash}`);
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
        contractInstance.getPastEvents('BidAuctionCanceled', {
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        }),
        web3.eth.getTransaction(txHash),
      ]);

      if (transaction.transactionIndex != null && events.length > 0) {
        const currentEvent = events.find(
          (event) => event.transactionHash === txHash
        );
        let input = parseInput(transaction.input, web3);
        const { bidId } = input;
        const user = await commonService.getUserIdFromAddress(address, db);
        const bidPlaced = await getBidPlacedInfo(
          bidId,
          networks[0].id,
          user.id,
          db
        );
        if (!bidPlaced) {
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
            'externalCancelBidAuction'
          );
          await db.commit();
          return false;
        }

        if (currentEvent) {
          const [bidNft] = await Promise.all([
            addNewBidNft(
              bidPlaced,
              user.id,
              txHash,
              SALE_NFT_STATUS.SUCCESS,
              db
            ),
            commonService.updateStatusSaleNftById(
              bidPlaced.id,
              SALE_NFT_STATUS.NOT_COUNT,
              db
            ),
            updateHighestPriceAuction(bidPlaced.auction_session_id, db),
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
            'externalCancelBidAuction'
          );
        } else {
          await Promise.all([
            addNewBidNft(bidPlaced, user.id, txHash, SALE_NFT_STATUS.FAIL, db),
            commonService.updateFailExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            ),
          ]);

          socket.sendToSocket(
            {
              txHash: txHash,
              result: false,
              address: address.toLowerCase(),
            },
            'externalCancelBidAuction'
          );
          await db.commit();
          return;
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
        'externalCancelBidAuction'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateCancelBidAuction::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

async function getBidPlacedInfo(bidId, networkId, userId, db) {
  const sql = `SELECT sn.* FROM \`sale_nft\` sn JOIN \`nfts\` ON sn.nft_id = nfts.id WHERE sn.from_user_id = ${userId} AND sn.action = ${SALE_NFT_ACTION.BID_NFT} AND sn.bid_id = '${bidId}' AND nfts.network_id = ${networkId} ORDER BY sn.id DESC LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function addNewBidNft(
  bidInfo,
  userId,
  txHash,
  status = SALE_NFT_STATUS.SUCCESS,
  db
) {
  const checkOwner = await commonService.getOwnerNft(
    bidInfo.nft_id,
    bidInfo.to_user_id,
    db
  );

  const isReclaim = checkOwner[0] && Number(checkOwner[0].sale_total) === 0;

  const action =
    Number(bidInfo.status) === SALE_NFT_STATUS.MAKE_OFFER_EXPIRED || isReclaim
      ? SALE_NFT_ACTION.RECLAIM_BID_NFT
      : SALE_NFT_ACTION.CANCEL_BID_NFT;
  const data = {
    id: null,
    nftId: bidInfo.nft_id,
    fromUserId: userId,
    toUserId: bidInfo.to_user_id,
    quantity: bidInfo.quantity,
    receiveToken: bidInfo.receive_token,
    price: bidInfo.price,
    originalPrice: bidInfo.original_price,
    auctionSessionId: bidInfo.auction_session_id,
    bidId: bidInfo.bid_id,
  };
  const sql = `INSERT into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, tx_id, original_price,  network_token_id, auction_session_id, bid_id, parent_id) values
        (${bidInfo.nft_id}, ${userId}, ${bidInfo.to_user_id}, ${data.price}, ${data.quantity}, ${action}, '${bidInfo.receive_token}', ${status}, '${txHash}', ${bidInfo.original_price},  ${bidInfo.network_token_id}, ${bidInfo.auction_session_id}, ${bidInfo.bid_id}, ${bidInfo.id})`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

function parseInput(input, web3) {
  const array = ['uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);

  return {
    bidId: Number(result[0]),
  };
}

async function updateHighestPriceAuction(auctionId, db) {
  const [auction, bidHighest] = await Promise.all([
    auctionService.getAuctionSessionByIdAndStatus(
      auctionId,
      [AUCTION_SESSION_STATUS.ACTIVE],
      db
    ),
    auctionService.findBidHighestByAuctionId(auctionId, db),
  ]);
  if (auction) {
    let highestPrice;
    if (!bidHighest) {
      highestPrice = auction.start_price;
    } else {
      highestPrice = bidHighest.price;
    }
    await auctionService.updateHighestPriceById(
      auction,
      Number(highestPrice),
      db
    );
  }
}

module.exports = {
  run,
};
