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
  NFT_STANDARD_TYPE,
  MARKET_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`UpdateReclaimNftAuction: ${txHash}`);
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
        contractInstance.getPastEvents('AuctionReclaimed', {
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        }),
        web3.eth.getTransaction(txHash),
      ]);

      if (transaction.transactionIndex != null && events.length > 0) {
        const input = parseInput(transaction.input, web3);
        const auction =
          await auctionService.getAuctionByScAuctionIdAndNetworkId(
            input.auctionId,
            networks[0].id,
            db
          );

        if (!auction) {
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
            'externalReclaimNftAuction'
          );
          await db.commit();
          return false;
        }

        const [nft, user] = await Promise.all([
          commonService.getNftById(auction.nft_id, db),
          commonService.getUserIdFromAddress(address, db),
        ]);

        if (
          !nft ||
          (nft && Number(nft.standard_type) !== NFT_STANDARD_TYPE.ERC_721)
        ) {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalReclaimNftAuction'
          );
          await db.commit();
          return false;
        }

        if (events.length > 0) {
          const [bidNft] = await Promise.all([
            addReclaimNftAuction(auction, txHash, SALE_NFT_STATUS.SUCCESS, db),
            auctionService.updateAuctionStatus(
              auction.id,
              AUCTION_SESSION_STATUS.DONE,
              db
            ),
            auctionService.updateIsAuctionForNfts(
              auction.nft_id,
              IS_AUCTION_NFT.NO,
              db
            ),
            auctionService.updateMarketStatusNftById(
              auction.nft_id,
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
            'externalReclaimNftAuction'
          );
        } else {
          const [bidNft] = await Promise.all([
            addReclaimNftAuction(auction, txHash, SALE_NFT_STATUS.FAIL, db),
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
            'externalReclaimNftAuction'
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
        'externalReclaimNftAuction'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateReclaimNftAuction::Error');
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
    auctionId: Number(result[0]),
  };
}

async function addReclaimNftAuction(
  data,
  txHash,
  status = SALE_NFT_STATUS.SUCCESS,
  db
) {
  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, tx_id, original_price, auction_session_id) values 
            (${data.nft_id}, ${data.user_id}, ${data.user_id},
            ${Number(data.start_price)}, 1, ${SALE_NFT_ACTION.RECLAIM_NFT},
           '${data.receive_token}', ${status}, '${txHash}',
            ${data.start_price}, ${data.id})`;

  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

module.exports = {
  run,
};
