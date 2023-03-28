require('dotenv').config();
const commonService = require('./common.service');
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const { convertOriginalPriceToTotalPrice } = require('../common/helpers');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  NFT_STANDARD_TYPE,
  AUCTION_SESSION_STATUS,
} = require('../common/constant');
const auctionService = require('./auction.service');

async function run(txHash, address, networks, db) {
  console.log(
    `updateCancelAuctionData: ${txHash}, networks = ${networks[0].id}`
  );
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
        contractInstance.getPastEvents('AuctionCanceled', {
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        }),
        web3.eth.getTransaction(txHash),
      ]);

      if (transaction.transactionIndex != null && events.length > 0) {
        const currentEvent = events.find(
          (event) => event.transactionHash === txHash
        );

        if (currentEvent) {
          const input = parseInputCancel(transaction.input, web3);
          const [nft, user] = await Promise.all([
            auctionService.getNftByScAuctionId(
              input.auctionId,
              networks[0].id,
              db
            ),
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
              {
                auctionId: input.auctionId,
                txHash: txHash,
                result: false,
                address: address.toLowerCase(),
              },
              'cancelAuction'
            );
            await db.commit();
            return false;
          }
          const auctionSession =
            await auctionService.getAuctionSessionWithNftIdAndScAuctionId(
              input.auctionId,
              nft.id,
              db
            );

          if (!auctionSession) {
            await commonService.updateFailExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            );
            socket.sendToSocket(
              {
                auctionId: input.auctionId,
                txHash: txHash,
                result: false,
                address: address.toLowerCase(),
              },
              'cancelAuction'
            );
            await db.commit();
            return false;
          }

          const networkToken = commonService.getNetworkTokenByReceiveToken(
            auctionSession.receive_token,
            networks
          );
          await Promise.all([
            addCancelAuctionToSaleNft(
              nft,
              user,
              auctionSession,
              networkToken.networkTokenId,
              txHash,
              db
            ),
            auctionService.updateStatusAuctionById(
              auctionSession.id,
              AUCTION_SESSION_STATUS.CANCEL,
              db
            ),
            updateSaleNftWhenCancelAuction(auctionSession, db),
            auctionService.handleMinStartPriceWhenCancelAuction(
              auctionSession.nft_id,
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
              nft: nft,
              auctionId: input.auctionId,
              txHash: txHash,
              result: true,
              address: address.toLowerCase(),
            },
            'cancelAuction'
          );
        } else {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            {
              auctionId: input.auctionId,
              txHash: txHash,
              result: false,
              address: address.toLowerCase(),
            },
            'cancelAuction'
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
        { txHash: txHash, result: false, address: address.toLowerCase() },
        'cancelAuction'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('cancelAuction::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

function parseInputCancel(input, web3) {
  const array = ['uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);

  return {
    auctionId: result[0],
  };
}

async function updateSaleNftWhenCancelAuction(auctionSession, db) {
  const sql = `UPDATE \`sale_nft\` set status = ${SALE_NFT_STATUS.NOT_COUNT} 
        where nft_id = '${auctionSession.nft_id}' and auction_session_id = '${auctionSession.id}' 
        and action = ${SALE_NFT_ACTION.PUT_AUCTION} and status = ${SALE_NFT_STATUS.SUCCESS}`;
  await db.query(sql);
}

async function addCancelAuctionToSaleNft(
  nft,
  user,
  auctionSession,
  networkTokenId,
  txHash,
  db
) {
  const originalPrice = convertOriginalPriceToTotalPrice(
    auctionSession.start_price,
    nft.royalty,
    nft.platform_commission
  );

  const sql = `insert into \`sale_nft\` (nft_id, from_user_id, to_user_id, action, price, original_price, receive_token, status, tx_id, network_token_id, auction_session_id) VALUES
            (${nft.id}, ${user.id}, ${user.id}, ${SALE_NFT_ACTION.CANCEL_AUCTION}, ${auctionSession.start_price}, ${originalPrice}, '${auctionSession.receive_token}', ${SALE_NFT_STATUS.SUCCESS}, '${txHash}', ${networkTokenId}, ${auctionSession.id})`;
  const [result] = await db.query(sql);
  return { id: result.insertId };
}
module.exports = {
  run,
};
