require('dotenv').config();
const socket = require('./socket.service');
const commonService = require('./common.service');
const auctionService = require('./auction.service');
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  AUCTION_SESSION_STATUS,
  IS_AUCTION_NFT,
  MARKET_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`UpdateAcceptBidAuction: ${txHash}`);
  const web3 = commonService.getInstanceWeb3(networks[0]);
  const receipt = await web3.eth.getTransactionReceipt(txHash);
  if (receipt) {
    await synsData(receipt, address, txHash, networks, db, web3);
  } else {
    console.log(
      `Can't get receipt :: txHash :: ${txHash} :: network :: ${networks[0].name}`
    );
  }
}

async function synsData(receipt, address, txHash, networks, db, web3) {
  await db.beginTransaction();
  try {
    const checkTx = await commonService.checkTxIdExistedInSaleNft(txHash, db);

    if (!checkTx) {
      const contractInstance = new web3.eth.Contract(
        XANALIA_DEX_ABI,
        networks[0].xanalia_dex_contract
      );
      const [events, transaction] = await Promise.all([
        contractInstance.getPastEvents('BidAuctionClaimed', {
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
        const input = parseInput(transaction.input, web3);

        const user = await commonService.getUserIdFromAddress(address, db);
        const bidInfo = await getBidWinnerInfo(
          input.bidAuctionId,
          networks[0].id,
          user.id,
          db
        );

        if (!bidInfo) {
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
            'externalAcceptBidAuctionSession'
          );
          await db.commit();
          return false;
        }

        if (events.length > 0 && user) {
          const [bidNft] = await Promise.all([
            addNewBidNft(
              bidInfo,
              user.id,
              db,
              txHash,
              SALE_NFT_STATUS.SUCCESS,
              _bidAuctionId
            ),
            updateSuccessAcceptNft(bidInfo, db),
            updateOldBid(bidInfo.id, db),
            auctionService.updateAuctionStatus(
              bidInfo.auction_session_id,
              AUCTION_SESSION_STATUS.DONE,
              db
            ),
            auctionService.updateIsAuctionForNfts(
              bidInfo.nft_id,
              IS_AUCTION_NFT.NO,
              db
            ),
            auctionService.updateMarketStatusNftById(
              bidInfo.nft_id,
              MARKET_STATUS.NOT_ON_SALE,
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
            'externalAcceptBidAuctionSession'
          );
        } else {
          const [bidNft] = await Promise.all([
            addNewBidNft(
              bidInfo,
              user.id,
              db,
              txHash,
              SALE_NFT_STATUS.FAIL,
              _bidAuctionId
            ),
            commonService.updateFailExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            ),
          ]);
          socket.sendToSocket(
            {
              bidNft: bidNft,
              txHash: txHash,
              result: false,
              address: address.toLowerCase(),
            },
            'externalAcceptBidAuctionSession'
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
        {
          txHash: txHash,
          result: false,
          address: address.toLowerCase(),
        },
        'externalAcceptBidAuctionSession'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateAcceptBidAuction::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

function parseInput(input, web3) {
  const array = ['uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);

  return {
    bidAuctionId: Number(result[0]),
  };
}

async function getBidWinnerInfo(bidId, networkId, userId, db) {
  const sql = `SELECT sn.* FROM \`sale_nft\` sn JOIN \`auction_session\` aus ON aus.id = sn.auction_session_id JOIN \`nfts\` ON sn.nft_id = nfts.id 
                WHERE sn.to_user_id = ${userId} AND sn.bid_id = '${bidId}' 
                AND nfts.network_id = ${networkId} 
                AND sn.action = ${SALE_NFT_ACTION.BID_NFT} 
                AND sn.status = ${SALE_NFT_STATUS.SUCCESS} 
                AND aus.status IN (${AUCTION_SESSION_STATUS.ACTIVE}, ${AUCTION_SESSION_STATUS.CANCEL}, ${AUCTION_SESSION_STATUS.END}, ${AUCTION_SESSION_STATUS.UNSUCCESSFUL})
                ORDER BY sn.id DESC LIMIT 1`;
  const [result] = await db.query(sql);
  return result[0];
}

async function updateSuccessAcceptNft(data, db) {
  const [auctionOwnerNft, bidWinnerOwnerNft] = await Promise.all([
    commonService.getOwnerNft(data.nft_id, data.to_user_id, db),
    commonService.getOwnerNft(data.nft_id, data.from_user_id, db),
  ]);
  await commonService.updateOwnerNft(auctionOwnerNft[0], -data.quantity, db);

  if (bidWinnerOwnerNft.length > 0) {
    await commonService.updateOwnerNft(bidWinnerOwnerNft[0], data.quantity, db);
  } else {
    await commonService.newOwnerNft(
      data.nft_id,
      data.from_user_id,
      data.quantity,
      db
    );
  }
}

async function addNewBidNft(
  bidInfo,
  userId,
  db,
  txHash,
  status = SALE_NFT_STATUS.SUCCESS,
  bidAuctionId
) {
  let data = {
    id: null,
    nftId: bidInfo.nft_id,
    fromUserId: userId,
    toUserId: bidInfo.from_user_id,
    price: bidInfo.price,
    quantity: bidInfo.quantity,
    originalPrice: bidInfo.original_price,
    auctionSessionId: bidInfo.auction_session_id,
    bidAuctionId,
  };
  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, pending_quantity, success_quantity, action,
        receive_token, status, expired, tx_id, original_price, network_token_id, auction_session_id, bid_id) values 
        (${bidInfo.nft_id}, ${bidInfo.to_user_id}, ${bidInfo.from_user_id},
        ${bidInfo.price}, ${bidInfo.quantity}, ${bidInfo.pending_quantity},
        ${bidInfo.success_quantity}, ${SALE_NFT_ACTION.ACCEPT_BID_NFT},
        '${bidInfo.receive_token}', ${status}, ${bidInfo.expired}, '${txHash}',
        ${bidInfo.original_price}, ${bidInfo.network_token_id},
        ${bidInfo.auction_session_id}, ${Number(bidAuctionId)})`;

  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

async function updateOldBid(id, db) {
  const sql = `UPDATE \`sale_nft\` SET status = ${SALE_NFT_STATUS.NOT_COUNT}, action = ${SALE_NFT_ACTION.WINNER_BID_NFT} WHERE id = ${id}`;
  await db.query(sql);
}

module.exports = {
  run,
};
