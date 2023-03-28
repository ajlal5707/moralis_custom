exports.TRANSACTION_ACTION = {
  //   createNFT: 0,
  putOnSale: 1,
  putOnSale1155: 111,
  editOrder:32,
  putOnFarm: 2,
  buyNft: 3,
  removeSale: 4,
  transferNft: 5, // is Burn
  stake: 6,
  unStake: 7,
  redeem: 8,
  createCollection: 9,
  makeOffer: 10,
  acceptOffer: 11,
  burnBatch: 12,
  updateOrder: 13,
  updateOffer: 14,
  cancelOffer: 15,
  //   createNftErc721: 16,
  createNftXanalia721: 17,
  placeBid: 18,
  acceptBid: 19,
  cancelBid: 20,
  editBid: 21,
  createAuction: 22,
  cancelAuction: 23,
  // claimMoney: 24,
  // claimNft: 25,
  reclaimNft: 26,
  changeOwnerNft721: 28,
  changeOwnerNft1155: 29,
  mintAndPutSale: 30,
  mintAndPutAuction: 31,
  putOnRent: 33,
  removeRent: 34,
  safeTransferNft721: 99,
  genesisUserWordPayment: 70,
  deemoCraftNfts: 77,
  lockUnlockNfts: 78,
};

exports.SALE_NFT_ACTION = {
  PUT_ON_SALE: 0,
  MAKE_OFFER: 1,
  CANCEL_SALE_NFT: 2,
  BUY_NFT: 3,
  ACCEPT_NFT: 4,
  UPDATE_NFT: 5,
  BURN_NFT: 6,
  CANCEL_MAKE_OFFER: 9,
  RECLAIM_MAKE_OFFER: 10,
  MINT_NFT: 15,
  SALE_TRANSFER_NFT: 89,

  CANCEL_AUCTION: 18,
  PUT_AUCTION: 19,
  BID_NFT: 20,
  BID_EDITED: 21,
  CANCEL_BID_NFT: 22,
  RECLAIM_BID_NFT: 24,
  WINNER_BID_NFT: 23,
  ACCEPT_BID_NFT: 25,
  RECLAIM_NFT: 26,

  CHANGE_OWNER_NFT: 28,
  PUT_ON_RENT: 33,
  CANCEL_RENT_NFT:34,
  deemoCraftNfts: 77,
  lockUnlockNfts: 78,
  unlockNft:79
};

exports.SALE_NFT_STATUS = {
  NEW: 0,
  SUCCESS: 1,
  FAIL: -1,
  NOT_COUNT: 2,
  MAKE_OFFER_EXPIRED: 4,
};

exports.EXTERNAL_TRANSACTION_STATUS = {
  NEW: 0,
  SUCCESS: 1,
  FAIL: -1,
};

exports.NFT_STATUS = {
  PENDING: 0,
  DONE: 1,
  FAIL: 2,
  BURNED_ALL: 3,
  CENSORED: 4,
};

exports.NFT_TYPE = {
  NONE: 0,
  SALE: 1,
  FARM: 2,
};

exports.NFT_FEATURE = {
  NO: 0,
};

exports.COLLECTION_TYPE = {
  xanalia1155Artist: 0,
  xanalia1155General: 1,
  xanalia1155: 2, // farm
  erc721: 3,
  xanalia721: 4,
  xanalia721Artist: 5,
};

exports.COLLECTION_STATUS = {
  PENDING: 0,
  DONE: 1,
  FAIL: 2,
};

exports.NFT_STANDARD_TYPE = {
  ERC_1155: 0,
  ERC_721: 1,
};

exports.AUCTION_SESSION_STATUS = {
  FAIL: -1,
  NEW: 0,
  ACTIVE: 1,
  END: 2,
  UNSUCCESSFUL: 3,
  CANCEL: 4,
  DONE: 5,
  MINT_WITH_NFT: 15,
};

exports.MARKET = {
  NO_MARKET: 0,
  COMMON_MARKET: 1,
  TOP_MARKET: 2,
};

exports.IS_AUCTION_NFT = {
  NO: 0,
  YES: 1,
};

exports.MARKET_STATUS = {
  NOT_ON_SALE: 0,
  ON_FIX_PRICE: 1,
  ON_AUCTION: 2,
  CANCEL_AUCTION: 3,
  IMCOMMING_AUCTION: 4,
  END_AUCTION: 5,
  ON_RENT: 6,
};
