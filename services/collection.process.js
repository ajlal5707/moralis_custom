require('dotenv').config();
const COLLECTION_PRIVATE_ABI = require('../abi/collection_private_abi.json');
const socket = require('./socket.service');
const commonService = require('./common.service');

async function run(txHash, address, networks, db) {
  console.log(`updateCollection: ${txHash}, network = ${networks[0].id}`);
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
  try {
    const checkTx = await checkTxIdExisted(txHash, db);

    if (!checkTx) {
      const user = await commonService.getUserIdFromAddress(address, db);
      const collectionAddress = receipt.logs[0].address;
      const collectionName = await getCollectionName(collectionAddress, web3);
      const collectionId = await saveCollection(
        user,
        collectionAddress,
        txHash,
        collectionName,
        networks[0].id,
        db
      );
      await commonService.updateSuccessExternalTransaction(
        txHash,
        networks[0].moralis_transactions,
        db
      );

      socket.sendToSocket(
        {
          txHash: txHash,
          result: true,
          collectionId: collectionId,
          address: address.toLowerCase(),
          collectionAddress,
        },
        'externalCreateCollection'
      );
    } else {
      await commonService.updateFailExternalTransaction(
        txHash,
        networks[0].moralis_transactions,
        db
      );
      socket.sendToSocket(
        { txHash: txHash, result: false, address: address.toLowerCase() },
        'externalCreateCollection'
      );
    }
  } catch (error) {
    console.log('updateCollection::Error');
    console.log(error);
    throw error;
  }
}

async function getCollectionName(collectionAddress, web3) {
  const contractInstance = new web3.eth.Contract(
    COLLECTION_PRIVATE_ABI,
    collectionAddress
  );
  return await contractInstance.methods.name().call();
}

async function saveCollection(
  user,
  collections,
  txHash,
  collectionName,
  networkId,
  db
) {
  const sql = `UPDATE collections SET hash_transaction = '${txHash}', status = 1, contract_address = '${collections}' WHERE network_id = '${networkId}' AND user_id = '${user.id}' AND name = '${collectionName}' ORDER BY id DESC LIMIT 1`;
  await db.query(sql);
  const sql2 = `SELECT id FROM collections WHERE network_id = ${networkId} AND contract_address = '${collections}' AND name = '${collectionName}' limit 1`;
  const [collection] = await db.query(sql2);

  if (collection.length === 0) return null;
  return collection[0].id;
}

async function checkTxIdExisted(txHash, db) {
  const sql = `SELECT id FROM \`collections\` WHERE hash_transaction LIKE '${txHash}' limit 1`;
  const [result] = await db.query(sql);
  return result.length > 0;
}

module.exports = {
  run,
};
