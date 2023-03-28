require('dotenv').config();
const commonService = require('./common.service');
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
const socket = require('./socket.service');
const { convertWeiIntoPrice } = require('../common/helpers');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  NFT_STANDARD_TYPE,
  AUCTION_SESSION_STATUS,
  NFT_STATUS,
  MARKET_STATUS,
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
    const checkTxNft = await commonService.checkTxIdExistedInNft(txHash, db);
    const checkTxSaleNft = await commonService.checkTxIdExistedInSaleNft(
      txHash,
      db
    );

    if (!checkTxNft && !checkTxSaleNft) {
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
          const { _auctionId, _tokenId } = returnValues;
          const input = parseInput(transaction.input, networks, web3);

          const [user, networkToken] = await Promise.all([
            commonService.getUserIdFromAddress(address, db),
            commonService.getNetworkTokenByContract(input.paymentToken, db),
          ]);

          const nft = await updateSuccessTransactionNft(
            _tokenId,
            input,
            user,
            txHash,
            networks[0].id,
            MARKET_STATUS.IMCOMMING_AUCTION,
            db
          );

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
              'externalCreateNft'
            );
            await db.commit();
            return false;
          }

          let updateDataAuction = {
            ...input,
            ...{
              userId: user.id,
              nftId: nft.id,
              scAuctionId: _auctionId,
            },
          };

          updateDataAuction.startTime = moment
            .unix(updateDataAuction.startTime)
            .utc()
            .format('YYYY-MM-DD HH:mm:ss');
          updateDataAuction.endTime = moment
            .unix(updateDataAuction.endTime)
            .utc()
            .format('YYYY-MM-DD HH:mm:ss');
          updateDataAuction.networkTokenId = networkToken.id || null;

          const auction = await updateAuctionSucess(
            updateDataAuction,
            txHash,
            db
          );
          await Promise.all([
            auctionService.addStartBidAuction(
              updateDataAuction,
              nft,
              auction.id,
              txHash,
              db
            ),
            auctionService.updateNftWhenCreateAuction(
              updateDataAuction,
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
            'externalCreateNft'
          );
        } else {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalCreateNft'
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
        'externalCreateNft'
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
    'string',
    'uint256',
    'address',
    'uint256',
    'uint256',
    'uint256',
  ];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);
  const network = commonService.getNetworkToken(result[3], networks);

  return {
    collectionAddress: result[0],
    uri: result[1],
    royalty: result[2],
    paymentToken: result[3],
    startPrice: Number(
      convertWeiIntoPrice(result[4], network.networkTokenDecimal)
    ),
    startTime: result[5],
    endTime: result[6],
    token: network.networkTokenName,
    network,
  };
}

async function updateSuccessTransactionNft(
  tokenId,
  data,
  user,
  txHash,
  networkId,
  marketStatus = null,
  db
) {
  let marketStatusSql =
    marketStatus !== null ? ` market_status = '${marketStatus}',` : '';
  const sql1 = `SELECT id FROM collections WHERE network_id = '${networkId}' AND contract_address LIKE '${data.collectionAddress}' AND (user_id = ${user.id} or collections.type = 6) ORDER BY id DESC LIMIT 1`;
  const [collection] = await db.query(sql1);
  if (!collection[0]) {
    return null;
  }
  const sql2 = `UPDATE nfts SET is_draft = 0, status = ${NFT_STATUS.DONE}, ${marketStatusSql} token_id = '${tokenId}', hash_transaction='${txHash}', standard_type = ${NFT_STANDARD_TYPE.ERC_721} WHERE network_id = '${networkId}' AND collections_id = ${collection[0].id} AND ipfs_json LIKE '%${data.uri}' AND status = ${NFT_STATUS.PENDING}`;
  await db.query(sql2);
  const sql3 = `SELECT * FROM nfts WHERE token_id = '${tokenId}' AND collections_id = ${collection[0].id} ORDER BY id DESC LIMIT 1`;
  const [nft] = await db.query(sql3);
  if (nft.length === 0) return null;

  const sql4 = `INSERT INTO \`sale_nft\` (nft_id, from_user_id, to_user_id, quantity, action, status, tx_id) values 
        (${nft[0].id}, ${user.id}, ${user.id}, ${nft[0].no_copy}, ${SALE_NFT_ACTION.MINT_NFT}, ${SALE_NFT_STATUS.SUCCESS}, '${txHash}')`;

  await Promise.all([
    db.query(sql4),
    commonService.newOwnerNft(nft[0].id, user.id, 1, db),
  ]);
  return nft[0];
}

async function updateAuctionSucess(data, txHash, db) {
  const sql = `SELECT id FROM \`auction_session\` WHERE nft_id = ${data.nftId} AND user_id = ${data.userId} AND status = ${AUCTION_SESSION_STATUS.MINT_WITH_NFT} AND sc_auction_id = -1 AND network_token_id = ${data.networkTokenId} ORDER BY id DESC LIMIT 1`;
  const [result] = await db.query(sql);
  const sql2 = `UPDATE \`auction_session\` SET status = ${AUCTION_SESSION_STATUS.NEW}, sc_auction_id = ${data.scAuctionId}, tx_id = '${txHash}' 
    WHERE nft_id = ${data.nftId} AND user_id = ${data.userId} AND status = ${AUCTION_SESSION_STATUS.MINT_WITH_NFT} AND sc_auction_id = -1 AND network_token_id = ${data.networkTokenId}`;
  await db.query(sql2);
  data.id = result[0].id;
  return data;
}

module.exports = {
  run,
};
