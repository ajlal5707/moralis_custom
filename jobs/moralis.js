require('dotenv').config();
const Moralis = require('moralis/node');
const commonService = require('../services/common.service');
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const XANA_GENESIS_PAYMENT_ABI = require('../abi/gensis_abi.json');
const XANALIA_RENT_ABI = require('../abi/xanalia_rent_abi.json');
const XANALIA_CRAFT_ABI = require('../abi/xanalia_craft_abi.json');
const XANALIA_Lock_Unlock_ABI = require('../abi/xanalia_lock_unlock_abi.json');
const XANALIA_DEX_1155_ABI = require('../abi/xanalia_dex_1155_abi.json');
const { TRANSACTION_ACTION } = require('../common/constant');

const { run: updateCollection } = require('../services/collection.process');
const { run: updateMakeOfferData } = require('../services/make-offer.process');
const { run: updatePutOnSaleData } = require('../services/put-on-sale.process');
const { run: updateBuyNftData } = require('../services/buy-nft.process');
const {
  run: updateCancelOfferData,
} = require('../services/cancel-offer.process');
const {
  run: updateAcceptOfferData,
} = require('../services/accept-offer.process');
const {
  run: createNftAndPutAuction,
} = require('../services/create-nft-and-put-auction.process');
const {
  run: createNftAndPutOnSale,
} = require('../services/create-nft-and-put-on-sale.process');
const {
  run: updateRemoveSaleData,
} = require('../services/remove-sale.process');
const {
  run: updateCreateAuctionData,
} = require('../services/create-auction.process');
const {
  run: updateCancelAuctionData,
} = require('../services/cancel-auction.process');
const {
  run: createNftXanalia721,
} = require('../services/create-nft-xanalia721.process');
const {
  run: updateReclaimNftAuction,
} = require('../services/reclaim-nft-auction.process');
const {
  run: updateCancelBidAuction,
} = require('../services/cancel-bid.process');
const { run: updatePlaceBidData } = require('../services/place-bid.process');
const { run: updateAcceptBidData } = require('../services/accept-bid.process');
const { run: editOrder } = require('../services/edit-order.process');
const { run: updateUserWordPayment } = require('../services/genesis-payment.process');
const { run: updatePutOnRentData } = require('../services/put-on-rent.process');
const {
  run: updateRemoveRentData,
} = require('../services/remove-rent.process');
const { run: updateCraftNftsData } = require('../services/deemo-craft.process');
const { run: lockUnlockNfts } = require('../services/lock-unlock-nfts.process');

const listAction = [
  {
    action: createNftXanalia721,
    rule: ['CollectibleCreated'],
    code: TRANSACTION_ACTION.createNftXanalia721,
  },
  {
    action: createNftAndPutAuction,
    rule: ['CollectibleCreated', 'AuctionCreated'],
    code: TRANSACTION_ACTION.mintAndPutAuction,
  },
  {
    action: createNftAndPutOnSale,
    rule: ['CollectibleCreated', 'OrderCreated'],
    code: TRANSACTION_ACTION.mintAndPutSale,
  },
  {
    action: updateCollection,
    rule: ['CollectionCreated'],
    code: TRANSACTION_ACTION.createCollection,
  },
  {
    action: updateMakeOfferData,
    rule: ['OfferCreated'],
    code: TRANSACTION_ACTION.makeOffer,
  },
  {
    action: updateCancelOfferData,
    rule: ['OfferCancelled'],
    code: TRANSACTION_ACTION.cancelOffer,
  },
  {
    action: updateAcceptOfferData,
    rule: ['AcceptOffer'],
    code: TRANSACTION_ACTION.acceptOffer,
  },
  {
    action: updatePutOnSaleData,
    rule: ['OrderCreated'],
    code: TRANSACTION_ACTION.putOnSale,
  },
  {
    action: updatePutOnRentData,
    rule: ['RentEvent'],
    code: TRANSACTION_ACTION.putOnRent,
  },
  {
    action: updateRemoveSaleData,
    rule: ['OrderCancelled'],
    code: TRANSACTION_ACTION.removeSale,
  },
  {
    action: updateRemoveRentData,
    rule: ['ClaimNFT'],
    code: TRANSACTION_ACTION.removeRent,
  },
  {
    action: updateCreateAuctionData,
    rule: ['AuctionCreated'],
    code: TRANSACTION_ACTION.createAuction,
  },
  {
    action: updateCancelAuctionData,
    rule: ['AuctionCanceled'],
    code: TRANSACTION_ACTION.cancelAuction,
  },
  {
    action: updateBuyNftData,
    rule: ['Buy'],
    code: TRANSACTION_ACTION.buyNft,
  },
  {
    action: updatePlaceBidData,
    rule: ['BidAuctionCreated'],
    code: TRANSACTION_ACTION.placeBid,
  },
  {
    action: updateAcceptBidData,
    rule: ['BidAuctionClaimed'],
    code: TRANSACTION_ACTION.acceptBid,
  },
  {
    action: updateReclaimNftAuction,
    rule: ['AuctionReclaimed'],
    code: TRANSACTION_ACTION.reclaimNft,
  },
  {
    action: updateCancelBidAuction,
    rule: ['BidAuctionCanceled'],
    code: TRANSACTION_ACTION.cancelBid,
  },
  {
    action: editOrder,
    rule: ['OrderEdited'],
    code: TRANSACTION_ACTION.editOrder,
  },
  {
    action: updateUserWordPayment,
    rule: ['Paid'],
    code: TRANSACTION_ACTION.genesisUserWordPayment,
  },
  {
    action: updateCraftNftsData,
    rule: ['CraftNFT'],
    code: TRANSACTION_ACTION.deemoCraftNfts,
  },
  {
    action: lockUnlockNfts,
    rule: ['Lock', 'Unlock'],
    code: TRANSACTION_ACTION.lockUnlockNfts,
  },
];

const transactionPending = {};
const transactionProcessing = {};
const queue = [];

async function connect(db) {
  try {
    await Moralis.start({
      serverUrl: "https://3avlocitsdzc.grandmoralis.com:2053/server",
      appId: "uzXZ15U3V2XGtFr0cuALvJISXvgqUpe3kEPG5yaN",
      masterKey: "N3SyBGAJvRznk6AlgHqC60fcB9k8jua92py6jhxP",
    });
    console.log(
      `🚀🚀🚀🚀🚀🚀🚀🚀 ~ Moralis config :: serverUrl ::  :: appId ::  :: masterKey ::  connect ~ Moralis Success 🚀🚀🚀🚀🚀🚀🚀🚀`
    );

    const [allNetwork, listNetworkToken] = await Promise.all([
      commonService.getAllNetwork(db),
      commonService.getListNetwork(db),
    ]);

    const handle = [];
    allNetwork.forEach((n) => {
      transactionPending[n.name] = {};
      const nw = listNetworkToken.filter((e) => e.id === n.id);
      handle.push(onSocketUpdate(nw, db));
    });
    await Promise.all(handle);
    await queueHandle(db);
  } catch (error) {
    console.log(
      '🚀 ~ file: moralis.js ~ line 160 ~ connect ~ error :: ',
      error.message
    );
    setTimeout(() => connect(db), 10 * 1000);
  }
}

async function scheduleScan(db) {
  const [allNetwork, listNetworkToken] = await Promise.all([
    commonService.getAllNetwork(db),
    commonService.getListNetwork(db),
  ]);

  const handle = [];
  allNetwork.forEach((n) => {
    const nw = listNetworkToken.filter((e) => e.id === n.id);
    handle.push(handleByNetwork(nw, db));
  });
  await Promise.all(handle);
}

async function handleByNetwork(networks, db) {
  try {
    const query = new Moralis.Query(networks[0].moralis_transactions);
    query.equalTo('receipt_status', 1);
    query.notEqualTo('isProcessed', true);
    query.ascending('block_number');
    query.limit(100);
    const results = await query.find();
    const resParse = JSON.parse(JSON.stringify(results));
    console.log(
      `🚀 Moralis resParse :: ${resParse.length} == network :: ${networks[0].name}`
    );
    for (let object of resParse) {
      if (!transactionProcessing[object.hash]) {
        transactionProcessing[object.hash] = true;
        queue.push({ object, networks });
      }
    }
  } catch (error) {
    console.log(
      '🚀 ~ file: moralis.js ~ line 197 ~ handleByNetwork ~ error :: ',
      error.message
    );
  }
}

async function onSocketUpdate(networks, db) {
  const query = new Moralis.Query(networks[0].moralis_transactions);
  const subscription = await query.subscribe();

  subscription.on('update', async (data) => {
    const object = JSON.parse(JSON.stringify(data));
    if (
      object.receipt_status &&
      !object.isProcessed &&
      !transactionProcessing[object.hash]
    ) {
      transactionProcessing[object.hash] = true;
      queue.push({ object, networks });
    }
  });
}

async function handleObject(object, networks, db) {
  const web3 = commonService.getInstanceWeb3(networks[0]);

  await db.beginTransaction();
  try {
    const [checkTx, checkUser] = await Promise.all([
      commonService.searchTxHash(object.hash, db),
      commonService.getUserIdFromAddress(object.from_address, db),
    ]);

    if ((!checkTx[0] || checkTx[0].status === 0) && checkUser && checkUser.id) {
      let contractInstance;
      if (networks[0].xanaGenesisPaymentContract && networks[0].xanaGenesisPaymentContract.toLowerCase() == object.to_address.toLowerCase()) {
        contractInstance = new web3.eth.Contract(
          XANA_GENESIS_PAYMENT_ABI,
          networks[0].xanaGenesisPaymentContract
        );
      } else if (networks[0].rent_contract && networks[0].rent_contract.toLowerCase() == object.to_address.toLowerCase()) {
        contractInstance = new web3.eth.Contract(
          XANALIA_RENT_ABI,
          networks[0].rent_contract
        );
      } else if (networks[0].deemoContract && networks[0].deemoContract.toLowerCase() == object.to_address.toLowerCase()) {
        contractInstance = new web3.eth.Contract(
          XANALIA_CRAFT_ABI,
          networks[0].deemoContract
        )
      } else if (networks[0].xanalia_lock_contract && networks[0].xanalia_lock_contract.toLowerCase() == object.to_address.toLowerCase()) {
        contractInstance = new web3.eth.Contract(
          XANALIA_Lock_Unlock_ABI,
          networks[0].xanalia_lock_contract
        )
      } else if (networks[0].xanalia_dex_1155 && networks[0].xanalia_dex_1155.toLowerCase() == object.to_address.toLowerCase()) {
        contractInstance = new web3.eth.Contract(
          XANALIA_DEX_1155_ABI,
          networks[0].xanalia_dex_1155
        )
      } else {
        contractInstance = new web3.eth.Contract(
          XANALIA_DEX_ABI,
          networks[0].xanalia_dex_contract
        );
      }

      const events = await contractInstance.getPastEvents('allEvents', {
        fromBlock: object.block_number,
        toBlock: object.block_number,
      });

      if (events.length === 0) {
        await handleTransactionPending(
          networks[0].name,
          networks[0].moralis_transactions,
          object.hash,
          db
        );
        delete transactionProcessing[object.hash];
        console.log(
          `🚀 Action = ${object.hash} :: network :: ${networks[0].name
          } :: times ${transactionPending[networks[0].name][object.hash]
          } Pending`
        );
        return;
      }

      listAction.forEach((action) => {
        action.count = 0;
        action.rule.forEach((rule) => {
          if (
            events.find(
              (e) => e.event === rule && e.transactionHash === object.hash
            )
          )
            action.count += 1;
        });
      });
      listAction.sort((a, b) => b.count - a.count);
      if (listAction[0].count > 0) {
        const filterRes = listAction
          .filter((e) => listAction[0].count === e.count)
          .sort((a, b) => a.rule.length - b.rule.length);

        if (!checkTx[0]) {
          await commonService.createExternalTransaction(
            {
              txHash: object.hash,
              address: object.from_address,
              action: filterRes[0].code,
              networkId: networks[0].id,
            },
            db
          );
        }
        await filterRes[0].action(
          object.hash,
          object.from_address,
          networks,
          db
        );
        delete transactionProcessing[object.hash];
      } else {
        throw `Break`;
      }
    } else if (
      (checkTx[0] && (checkTx[0].status === -1 || checkTx[0].status === 1)) ||
      !checkUser ||
      !checkUser.id
    ) {
      await commonService.updateFailExternalTransaction(
        object.hash,
        networks[0].moralis_transactions,
        db
      );
      delete transactionProcessing[object.hash];
    }

    await db.commit();
  } catch (error) {
    console.log(
      `🚀 file: moralis.js ~ line 307 ~ handleByNetwork ~ error txHash = ${object.hash}, network :: ${networks[0].name}, error = ${error}`
    );
    await db.rollback();
    await handleTransactionPending(
      networks[0].name,
      networks[0].moralis_transactions,
      object.hash,
      db
    );
    delete transactionProcessing[object.hash];
  }
}

async function handleTransactionPending(networkName, nameTable, hash, db) {
  transactionPending[networkName][hash] = transactionPending[networkName][hash]
    ? (transactionPending[networkName][hash] += 1)
    : 1;

  if (transactionPending[networkName][hash] === 5) {
    await commonService.updateFailExternalTransaction(hash, nameTable, db);
    delete transactionPending[networkName][hash];
  }
}

async function queueHandle(db) {
  try {
    while (true) {
      try {
        if (queue.length > 0) {
          const data = queue[0];
          await handleObject(data.object, data.networks, db);
          queue.splice(0, 1);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

module.exports = {
  connect,
  scheduleScan,
};
