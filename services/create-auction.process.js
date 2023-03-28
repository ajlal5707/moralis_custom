require('dotenv').config();
const commonService = require('./common.service');
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const { convertWeiIntoPrice } = require('../common/helpers');
const {
  NFT_STANDARD_TYPE,
  AUCTION_SESSION_STATUS,
} = require('../common/constant');
const moment = require('moment');
const auctionService = require('./auction.service');

async function run(txHash, address, networks, db) {
  console.log(
    `updateCreateAuctionData: ${txHash}, networks = ${networks[0].id}`
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
        contractInstance.getPastEvents('AuctionCreated', {
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
          const { returnValues } = currentEvent;
          const { _auctionId } = returnValues;
          const input = parseInput(transaction.input, networks, web3);
          const [nft, user] = await Promise.all([
            commonService.getNftByTokenAndNetwork(
              input.tokenId,
              input.tokenAddress,
              networks[0].id,
              db
            ),
            commonService.getUserIdFromAddress(address, db),
          ]);

          if (!nft || nft.standard_type === NFT_STANDARD_TYPE.ERC_1155) {
            await commonService.updateFailExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            );
            socket.sendToSocket(
              { txHash: txHash, result: false, address: address.toLowerCase() },
              'createAuction'
            );
            await db.commit();
            return false;
          }

          let insertData = {
            ...input,
            ...{
              userId: user.id,
              nftId: nft.id,
              scAuctionId: _auctionId,
            },
          };

          insertData.startTime = moment
            .unix(insertData.startTime)
            .utc()
            .format('YYYY-MM-DD HH:mm:ss');
          insertData.endTime = moment
            .unix(insertData.endTime)
            .utc()
            .format('YYYY-MM-DD HH:mm:ss');

          const networkToken = await commonService.getNetworkTokenByContract(
            input.paymentToken,
            db
          );
          insertData.networkTokenId = networkToken.id || null;

          const auction = await addNewAuction(insertData, txHash, db);
          await Promise.all([
            auctionService.addStartBidAuction(
              insertData,
              nft,
              auction.id,
              txHash,
              db
            ),
            auctionService.updateNftWhenCreateAuction(
              insertData,
              nft,
              user,
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
              txHash: txHash,
              result: true,
              address: address.toLowerCase(),
            },
            'createAuction'
          );
        } else {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'createAuction'
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
        'createAuction'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('startAuction::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

function parseInput(input, networks, web3) {
  const array = [
    'address',
    'address',
    'uint256',
    'uint256',
    'uint256',
    'uint256',
  ];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);
  const network = commonService.getNetworkToken(result[1], networks);

  return {
    tokenAddress: result[0],
    paymentToken: result[1],
    tokenId: Number(result[2]),
    startPrice: Number(
      convertWeiIntoPrice(result[3], network.networkTokenDecimal)
    ),
    startTime: result[4],
    endTime: result[5],
    token: network.networkTokenName,
    network,
  };
}

async function addNewAuction(data, txHash, db) {
  const sql = `INSERT into \`auction_session\` (nft_id, user_id, highest_price, start_price, start_time, end_time, status, receive_token, sc_auction_id, tx_id, network_token_id) VALUES 
                (${data.nftId}, ${data.userId}, ${data.startPrice}, ${data.startPrice}, '${data.startTime}', '${data.endTime}', ${AUCTION_SESSION_STATUS.NEW}, '${data.token}', ${data.scAuctionId}, '${txHash}', ${data.networkTokenId})`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

module.exports = {
  run,
};
