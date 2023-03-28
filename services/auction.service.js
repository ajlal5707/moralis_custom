const moment = require('moment');
const {
  AUCTION_SESSION_STATUS,
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  IS_AUCTION_NFT,
  MARKET_STATUS,
} = require('../common/constant');
const { convertOriginalPriceToTotalPrice } = require('../common/helpers');

async function getNftByScAuctionId(scAuctionId, networkId, db) {
  const sql = `SELECT n.* from nfts n join \`auction_session\` a on n.id = a.nft_id where a.sc_auction_id = '${scAuctionId}' and n.network_id = ${networkId} ORDER BY a.id desc LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function getAuctionSessionWithNftIdAndScAuctionId(
  scAuctionId,
  nftId,
  db
) {
  const sql = `select * from \`auction_session\` where sc_auction_id = ${scAuctionId} and nft_id = ${nftId} ORDER BY id DESC limit 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function getAuctionSessionById(id, db) {
  const sql = `select * from \`auction_session\` where id = ${id}`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function getAuctionSessionByIdAndStatus(id, status, db) {
  const sql = `select * from \`auction_session\` where id = ${id} AND status in (${status.toString()})`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function getAuctionByScAuctionIdAndNetworkId(scAuctionId, networkId, db) {
  let sql = `SELECT sn.* FROM \`auction_session\` sn JOIN nfts ON sn.nft_id = nfts.id WHERE sn.sc_auction_id = '${scAuctionId}' and nfts.network_id = ${networkId} ORDER BY sn.id DESC LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function updateStatusAuctionById(auctionSessionId, status, db) {
  const sql = `UPDATE \`auction_session\` set status = ${status} where id = ${auctionSessionId}`;
  await db.query(sql);
}

async function updateMarketStatusNftById(nftId, marketStatus, db) {
  const sql = `UPDATE nfts set market_status = ${marketStatus} where id = ${nftId}`;
  await db.query(sql);
}

async function getListAuctionNeedStart(db) {
  const now = moment().utc().format('YYYY-MM-DD H:m:s');
  const sql = `SELECT * FROM \`auction_session\` WHERE status = ${AUCTION_SESSION_STATUS.NEW} and start_time <= '${now}'`;
  const [result] = await db.query(sql);
  return result;
}

async function getListAuctionNeedEnd(db) {
  const now = moment().utc().format('YYYY-MM-DD H:m:s');
  const sql = `SELECT * FROM \`auction_session\` WHERE status = ${AUCTION_SESSION_STATUS.ACTIVE} and end_time <= '${now}'`;
  const [result] = await db.query(sql);
  return result;
}

async function findBidHighestByAuctionId(auctionId, db) {
  const sql = `SELECT * FROM \`sale_nft\` WHERE auction_session_id = ${auctionId} and action = ${SALE_NFT_ACTION.BID_NFT} 
        AND status IN (${SALE_NFT_STATUS.SUCCESS}, ${SALE_NFT_STATUS.MAKE_OFFER_EXPIRED}) ORDER BY price DESC LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function findPutAuction(auctionId, userId, db) {
  const sql = `SELECT * FROM \`sale_nft\` WHERE auction_session_id = ${auctionId} and action = ${SALE_NFT_ACTION.PUT_AUCTION} 
        AND from_user_id = ${userId} and to_user_id = ${userId} order by id desc limit 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function handleMinStartPriceWhenCancelAuction(nftId, db) {
  const sql = `UPDATE nfts SET min_start_price = 0, is_auction = 0, market_status = ${MARKET_STATUS.CANCEL_AUCTION} WHERE id = ${nftId}`;
  await db.query(sql);
}

async function addStartBidAuction(data, nft, auctionSessionId, txHash, db) {
  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, tx_id, original_price, auction_session_id, network_token_id) values 
                  (${data.nftId}, ${data.userId}, ${data.userId}, ${data.startPrice}, 1, ${SALE_NFT_ACTION.PUT_AUCTION}, '${data.token}', ${SALE_NFT_STATUS.SUCCESS}, '${txHash}', ${data.startPrice}, ${auctionSessionId}, ${data.networkTokenId})`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

async function updateNftWhenCreateAuction(data, nft, user, db) {
  let market = nft.market;
  if (market === 0) {
    market = user.user_type === 2 ? 2 : 1;
  }

  const sql = `UPDATE nfts SET min_start_price = ${data.startPrice}, market = ${market}, is_auction = 1, market_status = ${MARKET_STATUS.IMCOMMING_AUCTION}, is_draft = 0, auction_receive_token = '${data.token}', price = ${data.startPrice}, receive_token = '${data.token}' WHERE id = ${nft.id}`;
  await db.query(sql);
}

async function updateHighestPriceById(auction, price, db) {
  let sql = `UPDATE \`auction_session\` SET highest_price = ${price} WHERE id = ${auction.id}`;
  await db.query(sql);
}

async function updateAuctionStatus(auctionId, status, db) {
  const sql = `UPDATE \`auction_session\` SET status = ${status} WHERE id = '${auctionId}'`;
  await db.query(sql);
}

async function updateAuctionStatusByNftId(nftId, status, db) {
  const sql = `UPDATE \`auction_session\` SET status = ${status} WHERE nft_id = '${nftId}'`;
  await db.query(sql);
}

async function updateIsAuctionForNfts(nftId, isAuction, db) {
  const sql = `UPDATE nfts SET is_auction = ${isAuction} WHERE id = ${nftId}`;
  return await db.query(sql);
}

module.exports = {
  getNftByScAuctionId,
  getAuctionSessionWithNftIdAndScAuctionId,
  updateStatusAuctionById,
  getListAuctionNeedStart,
  getListAuctionNeedEnd,
  findBidHighestByAuctionId,
  findPutAuction,
  handleMinStartPriceWhenCancelAuction,
  addStartBidAuction,
  updateNftWhenCreateAuction,
  updateHighestPriceById,
  updateAuctionStatus,
  updateAuctionStatusByNftId,
  updateIsAuctionForNfts,
  updateMarketStatusNftById,
  getAuctionByScAuctionIdAndNetworkId,
  getAuctionSessionById,
  getAuctionSessionByIdAndStatus,
};
