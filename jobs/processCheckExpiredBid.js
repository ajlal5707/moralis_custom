require('dotenv/config');
const { SALE_NFT_ACTION, SALE_NFT_STATUS } = require('../common/constant');

async function run(db) {
  try {
    while (true) {
      try {
        await processCheckExpiredBid(db);
        await new Promise((resolve) => setTimeout(resolve, 60000));
      } catch (error) {
        console.log(
          '🚀 ~ file: processCheckExpiredBid.js ~ line 11 ~ run ~ error',
          error
        );
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }
    }
  } catch (error) {
    console.log(
      '🚀 ~ file: processCheckExpiredBid.js ~ line 19 ~ run ~ error',
      error
    );
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}

async function getListBid(db) {
  const time = Number((new Date().getTime() / 1000).toFixed(0));
  const sql = `select * from \`sale_nft\` where status = ${SALE_NFT_STATUS.SUCCESS} and action IN (${SALE_NFT_ACTION.MAKE_OFFER}, ${SALE_NFT_ACTION.BID_NFT}) and expired < ${time}`;
  const [result] = await db.query(sql);
  return result;
}

async function processCheckExpiredBid(db) {
  try {
    const listBid = await getListBid(db);
    console.log(
      '🚀 ~ file: processCheckExpiredBid.js ~ line 37 ~ processCheckExpiredBid ~ listBid',
      listBid.length
    );

    for (let bid of listBid) {
      console.log(
        '🚀 ~ file: processCheckExpiredBid.js ~ line 43 ~ processCheckExpiredBid ~ bid',
        bid.id
      );
      await db.beginTransaction();
      try {
        const sql = `update \`sale_nft\` set status = ${SALE_NFT_STATUS.MAKE_OFFER_EXPIRED} where id = ${bid.id}`;
        await db.query(sql);
        await db.commit();
      } catch (error) {
        console.log(
          '🚀 ~ file: processCheckExpiredBid.js ~ line 54 ~ processCheckExpiredBid ~ error',
          error
        );
        await db.rollback();
      }
    }
  } catch (error) {
    console.log(
      '🚀 ~ file: processCheckExpiredBid.js ~ line 61 ~ processCheckExpiredBid ~ error',
      error
    );
  }
}

module.exports = { run };
