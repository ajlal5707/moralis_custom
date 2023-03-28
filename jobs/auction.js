require('dotenv').config();
const commonService = require('../services/common.service');
const auctionService = require('../services/auction.service');
const {
  SALE_NFT_STATUS,
  AUCTION_SESSION_STATUS,
  MARKET_STATUS,
} = require('../common/constant');

async function run(db) {
  try {
    while (true) {
      try {
        await Promise.all([startAuction(db), endAuction(db)]);
        await new Promise((resolve) => setTimeout(resolve, 30000));
      } catch (error) {
        console.log('🚀 ~ file: auction.js ~ line 17 ~ run ~ error', error);
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
  } catch (error) {
    console.log('🚀 ~ file: auction.js ~ line 22 ~ run ~ error', error);
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

const startAuction = async (db) => {
  const auctionUpdate = await auctionService.getListAuctionNeedStart(db);

  if (auctionUpdate.length > 0) {
    const p = [];
    auctionUpdate.forEach((auction) => {
      p.push(
        auctionService.updateStatusAuctionById(
          auction.id,
          AUCTION_SESSION_STATUS.ACTIVE,
          db
        ),
        auctionService.updateMarketStatusNftById(
          auction.nft_id,
          MARKET_STATUS.ON_AUCTION,
          db
        )
      );
    });
    await Promise.all(p);
  }
};

const endAuction = async (db) => {
  const auctionUpdate = await auctionService.getListAuctionNeedEnd(db);

  if (auctionUpdate.length > 0) {
    auctionUpdate.forEach(async (auction) => {
      await handlerAuctionWhenEnd(auction, db);
    });
  }
};

const handlerAuctionWhenEnd = async (auction, db) => {
  await db.beginTransaction();
  try {
    const p = [];
    const [bidHighest, putAuction] = await Promise.all([
      auctionService.findBidHighestByAuctionId(auction.id, db),
      auctionService.findPutAuction(auction.id, auction.user_id, db),
      auctionService.handleMinStartPriceWhenCancelAuction(auction.nft_id, db),
    ]);

    if (putAuction) {
      p.push(
        commonService.updateStatusSaleNftById(
          putAuction.id,
          SALE_NFT_STATUS.NOT_COUNT,
          db
        )
      );
    }

    if (!bidHighest) {
      p.push(
        auctionService.updateStatusAuctionById(
          auction.id,
          AUCTION_SESSION_STATUS.UNSUCCESSFUL,
          db
        )
      );
    } else {
      p.push(
        auctionService.updateStatusAuctionById(
          auction.id,
          AUCTION_SESSION_STATUS.END,
          db
        )
      );
    }

    p.push(
      auctionService.updateMarketStatusNftById(
        auction.nft_id,
        MARKET_STATUS.END_AUCTION,
        db
      )
    );

    await Promise.all(p);
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  }
};

module.exports = { run };
