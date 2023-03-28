require('dotenv').config();
const { getDbConnection } = require('../database/dbService');
const { run: auctionJob } = require('./auction');
const { connect: connectMoralis, scheduleScan } = require('./moralis');
const { run: expiredJob } = require('./processCheckExpiredBid');

async function main() {
  const db = await getDbConnection();
  console.log(db)
  if (!db) {
    console.log(
      '🚀 ~ file: processGetReceiptTransaction.js ~ line 51 ~ main ~ db',
      'CONNECT DATABASE NOT UNSUCCESSFUL'
    );
    return;
  }
  auctionJob(db);
  expiredJob(db);
  connectMoralis(db);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  try {
    while (true) {
      try {
        await scheduleScan(db);
        await new Promise((resolve) => setTimeout(resolve, 20 * 1000));
      } catch (error) {
        console.log(
          '🚀 ~ file: processGetReceiptTransaction.js ~ line 65 ~ main ~ error',
          error
        );
        await new Promise((resolve) => setTimeout(resolve, 20 * 1000));
      }
    }
  } catch (error) {
    console.log(
      '🚀 ~ file: processGetReceiptTransaction.js ~ line 73 ~ main ~ error',
      error
    );
    await new Promise((resolve) => setTimeout(resolve, 20 * 1000));
  }
}

main();
