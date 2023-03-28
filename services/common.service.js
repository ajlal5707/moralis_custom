const Web3 = require('web3');
const {
  EXTERNAL_TRANSACTION_STATUS,
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
} = require('../common/constant');
const Moralis = require('moralis/node');

function getInstanceWeb3(network) {
  return new Web3(network.rpc);
}

async function createExternalTransaction(data, db) {
  const sql = `INSERT INTO \`external_transaction\` (tx_hash, action, status, address, network_id) values 
    ('${data.txHash}', ${data.action}, ${EXTERNAL_TRANSACTION_STATUS.NEW}, '${data.address}', ${data.networkId})`;
  const [result] = await db.query(sql);
  return result;
}

async function getListTxHashPending(db) {
  const sql = `SELECT * FROM \`external_transaction\` WHERE status = ${EXTERNAL_TRANSACTION_STATUS.NEW}`;
  const [result] = await db.query(sql);
  return result;
}

async function searchTxHash(txHash, db) {
  const sql = `SELECT * FROM \`external_transaction\` WHERE tx_hash = '${txHash}' LIMIT 1`;
  const [result] = await db.query(sql);
  return result;
}

async function getListNetwork(db) {
  const sql = `SELECT n.*, nt.decimal AS networkTokenDecimal, nt.contract_address AS networkTokenContractAddress,
            nt.token_name AS networkTokenName, nt.id AS networkTokenId, nt.currency AS networkTokenCurrency,
            nt.is_native_token AS networkTokenIsNativeToken 
            FROM networks n JOIN network_tokens nt ON n.id = nt.network_id
            WHERE n.status = 1 AND nt.status = 1`;
  const [result] = await db.query(sql);
  return result;
}

async function getAllNetwork(db) {
  const sql = `SELECT * from networks WHERE status = 1 and moralis_transactions != ""`;
  const [result] = await db.query(sql);
  return result;
}

async function checkTxIdExistedInNft(transactionHash, db) {
  const sql = `SELECT id FROM \`nfts\` WHERE hash_transaction LIKE '${transactionHash}' LIMIT 1`;
  const [result] = await db.query(sql);
  return result.length > 0;
}

async function getUserIdFromAddress(address, db) {
  const sql = `SELECT u.id from users u join \`user-wallet\` uw on u.user_wallet_id = uw.id where uw.address LIKE '${address}'`;
  const [result] = await db.query(sql);
  if (result.length === 0) return result;
  return {
    id: result[0].id,
  };
}

async function updateExternalTransaction(txHash, status, db) {
  const sql = `UPDATE \`external_transaction\` SET status = ${status} WHERE tx_hash = '${txHash}'`;
  const [result] = await db.query(sql);
  return result;
}

async function updateSuccessExternalTransaction(txHash, tableName, db) {
  return await Promise.all([
    updateIsProcessedMoralisDone(txHash, tableName),
    updateExternalTransaction(txHash, EXTERNAL_TRANSACTION_STATUS.SUCCESS, db),
  ]);
}

async function updateFailExternalTransaction(txHash, tableName, db) {
  return await Promise.all([
    updateIsProcessedMoralisDone(txHash, tableName, false),
    updateExternalTransaction(txHash, EXTERNAL_TRANSACTION_STATUS.FAIL, db),
  ]);
}

async function newOwnerNft(nftId, userId, quantity, db) {
  const sql = `INSERT into owner_nft value (NULL, ${quantity}, 0, ${userId}, ${nftId})`;
  const [result] = await db.query(sql);
  return result;
}

async function checkTxIdExistedInSaleNft(txHash, db) {
  const sql = `SELECT id FROM \`sale_nft\` WHERE tx_id LIKE '${txHash}' LIMIT 1`;
  const [result] = await db.query(sql);
  return result.length > 0;
}

async function getUserAddressFromId(id, db) {
  const sql = `SELECT uw.address from \`user-wallet\` uw join users u on u.user_wallet_id = uw.id where u.id = ${id}`;
  const [result] = await db.query(sql);
  return result[0].address;
}

function getNetworkToken(token, networks) {
  let network = networks.find(
    (network) =>
      token.toLowerCase() === network.networkTokenContractAddress.toLowerCase()
  );
  if (network) {
    return network;
  } else if (token === '0x0000000000000000000000000000000000000000') {
    network = networks.find(
      (network) => network.networkTokenIsNativeToken === 1
    );
    if (network) {
      return network;
    }
  }
  throw `Not found receiveToken of token = ${token} with network = ${networks[0].id}`;
}

function getNetworkTokenByReceiveToken(receiveToken, networks) {
  let network = networks.find(
    (network) =>
      receiveToken.toLowerCase() === network.networkTokenName.toLowerCase()
  );
  if (network) {
    return network;
  }
  throw `Not found receiveToken of token = ${token} with network = ${networks[0].id}`;
}

async function getMinPutOnSale(nftId, db) {
  const sql = `SELECT COALESCE(s.price, 0) as price, s.receive_token, s.network_token_id FROM \`sale_nft\` s where nft_id=${nftId} and action = ${SALE_NFT_ACTION.PUT_ON_SALE} and status = ${SALE_NFT_STATUS.SUCCESS};`;
  const [result] = await db.query(sql);
  let tmpPrice = Number.MAX_VALUE;
  let minPrice;
  let receiveToken;

  for (const data of result) {
    const price = Number(data.price);
    if (data.receive_token.includes('ETH')) {
      if (tmpPrice > price) {
        tmpPrice = price;
        minPrice = price;
        receiveToken = data.receiveToken;
      }
    } else {
      const networkToken = await db.query(
        `SELECT * from network_tokens where id=${data.network_token_id} LIMIT 1`
      );
      if (networkToken.length && networkToken[0].currency) {
        const rate = await redisService.exchangeRateCoin(
          networkToken[0].currency,
          'ETH'
        );
        const priceExchanged = price * Number(rate);
        if (tmpPrice > priceExchanged) {
          tmpPrice = priceExchanged;
          minPrice = price;
          receiveToken = data.receiveToken;
        }
      }
    }
  }

  console.log(
    `The min sale price with nftId ${nftId} is ${minPrice}, and receive token is ${receiveToken}`
  );

  return {
    minPriceSaleNft: minPrice,
    receiveTokenSaleNft: receiveToken,
  };
}

async function getNftById(nftId, db) {
  const sql = `SELECT * FROM nfts where id = ${nftId} LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function getNftByTokenAndNetwork(tokenId, tokenAddress, networkId, db) {
  const sql = `SELECT n.*, c.type AS collectionType FROM nfts n JOIN \`collections\` c ON c.id = n.collections_id 
            WHERE c.contract_address LIKE '${tokenAddress}' AND n.token_id='${tokenId}' AND n.network_id = '${networkId}' ORDER BY id DESC LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function getRemainingQuantity(nftId, db) {
  const sql = `SELECT SUM(sn.quantity - sn.success_quantity) as remainingQuantity FROM \`sale_nft\` AS sn 
            WHERE nft_id = ${nftId} AND ACTION = ${SALE_NFT_ACTION.PUT_ON_SALE} AND STATUS = ${SALE_NFT_STATUS.SUCCESS};`;
  const [count] = await db.query(sql);
  return Number(count[0].remainingQuantity) || 0;
}

async function updateNft(
  nftId,
  type,
  onSaleStatus,
  market,
  price,
  receiveToken,
  db,
  marketStatus = null
) {
  let marketStatusSql =
    marketStatus !== null ? ` market_status = ${marketStatus},` : '';
  let sql = `UPDATE nfts SET type = ${type}, on_sale_status = ${onSaleStatus}, market = ${market},
            price = 0, is_draft = 0 , ${marketStatusSql} receive_token = NULL WHERE id = ${nftId}`;
  if (receiveToken) {
    sql = `UPDATE nfts SET type = ${type}, on_sale_status = ${onSaleStatus}, market = ${market},
            price = ${price}, is_draft = 0 , ${marketStatusSql} receive_token = '${receiveToken}' WHERE id = ${nftId}`;
  }
  return await db.query(sql);
}

async function updateStatusSaleNftById(id, status, db) {
  const sql = `UPDATE \`sale_nft\` SET status = ${status} WHERE id = ${id}`;
  const [result] = await db.query(sql);
  return result;
}

async function getNetworkTokenByContract(contractAddress, db) {
  const sql = `SELECT * FROM network_tokens WHERE contract_address = '${contractAddress}'`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function getListAddressOwnerNftNotCurrentUser(nftId, userId, db) {
  const sql = `select uw.address as address, users.id as id from \`owner_nft\` owner join users on users.id = owner.user_id
  join \`user-wallet\` uw on users.user_wallet_id = uw.id where owner.nfts_id = ${nftId} and owner.sale_total > 0 and users.id != ${userId}`;
  const [result] = await db.query(sql);
  return result;
}

async function getListAddressOwnerNft(nftId, db) {
  const sql = `select uw.address as address, users.id as id from \`owner_nft\` owner join users on users.id = owner.user_id
        join \`user-wallet\` uw on users.user_wallet_id = uw.id where owner.nfts_id = ${nftId} and owner.sale_total > 0`;
  const [result] = await db.query(sql);
  return result;
}

async function getOwnerNft(nftId, userId, db) {
  const sql = `SELECT * from owner_nft where nfts_id = ${nftId} and user_id = ${userId}`;
  const [result] = await db.query(sql);
  return result;
}

async function updateOwnerNft(ownerNft, quantity, db) {
  const sql = `UPDATE owner_nft set sale_total = (sale_total + ${quantity}) where id = ${ownerNft.id}`;
  await db.query(sql);
}

async function getNetworkTokenById(id, db) {
  const sql = `SELECT * FROM \`network_tokens\` WHERE id = ${id} LIMIT 1`;
  const [result] = await db.query(sql);
  if (result.length === 0) return null;
  return result[0];
}

async function updateSaleNftStatusNotCountWhenChangeOwner(nftId, userId, db) {
  const sql = `UPDATE \`sale_nft\` SET status = ${SALE_NFT_STATUS.NOT_COUNT} WHERE nft_id = ${nftId} AND from_user_id = ${userId} AND action = ${SALE_NFT_ACTION.PUT_ON_SALE} AND status = ${SALE_NFT_STATUS.SUCCESS}`;
  await db.query(sql);
}

async function updateIsProcessedMoralisDone(txHash, tableName, status = true) {
  const TransactionCreature = Moralis.Object.extend(tableName);
  const query = new Moralis.Query(TransactionCreature);
  query.equalTo('hash', txHash);
  const transaction = await query.first();
  transaction.set('isProcessed', true);
  transaction.save(null, { useMasterKey: true });
  console.log(
    `🚀🚀🚀 ~ file: moralis.js ~ line 286 ~ updateIsProcessedDone :: =>>>>>>> STATUS = ${
      status ? 'SUCCESS' : 'FAILED'
    } :: Network Transaction = ${tableName} :: txHash = `,
    txHash
  );
  return transaction;
}

module.exports = {
  getMinPutOnSale,
  getInstanceWeb3,
  getListTxHashPending,
  getListNetwork,
  updateFailExternalTransaction,
  createExternalTransaction,
  checkTxIdExistedInNft,
  getUserIdFromAddress,
  updateSuccessExternalTransaction,
  newOwnerNft,
  checkTxIdExistedInSaleNft,
  getNetworkToken,
  getNftByTokenAndNetwork,
  getRemainingQuantity,
  updateNft,
  getNftById,
  getNetworkTokenByReceiveToken,
  updateStatusSaleNftById,
  getUserAddressFromId,
  getNetworkTokenByContract,
  getListAddressOwnerNft,
  getListAddressOwnerNftNotCurrentUser,
  getOwnerNft,
  updateOwnerNft,
  getNetworkTokenById,
  searchTxHash,
  getAllNetwork,
  updateIsProcessedMoralisDone,
  updateSaleNftStatusNotCountWhenChangeOwner,
};
