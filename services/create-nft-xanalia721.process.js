require('dotenv').config();
const socket = require('./socket.service');
const commonService = require('./common.service');
const { getInstanceWeb3 } = require('./common.service');
const {
  NFT_STANDARD_TYPE,
  NFT_STATUS,
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`createNftXanalia721: ${txHash}, networks = ${networks[0].id}`);
  const web3 = getInstanceWeb3(networks[0]);
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
    const checkTx = await commonService.checkTxIdExistedInNft(txHash, db);

    if (!checkTx) {
      const transaction = await web3.eth.getTransaction(txHash);
      const input = parseInput(transaction.input, web3);
      const user = await commonService.getUserIdFromAddress(address, db);
      const tokenId = Number(
        await web3.utils.hexToNumberString(receipt.logs[0].topics[3])
      );
      const nft = await updateSuccessTransaction(
        tokenId,
        input,
        user,
        txHash,
        networks[0].id,
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

      const saleData = {
        quantity: nft.quantity,
        price: nft.price,
      };
      socket.sendToSocket(
        {
          nft: nft,
          txHash: txHash,
          result: true,
          saleData: saleData,
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
    await db.commit();
  } catch (error) {
    console.log('Error => createNftXanalia721');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

function parseInput(input, web3) {
  const array = ['address', 'string', 'uint256'];
  input = input.slice(10, input.length);
  const data = web3.eth.abi.decodeParameters(array, input);

  return {
    collectionAddress: data[0],
    uri: data[1],
    royalty: data[2],
  };
}

async function updateSuccessTransaction(
  tokenId,
  data,
  user,
  txHash,
  networkId,
  db
) {
  const sql1 = `SELECT id FROM collections WHERE network_id = '${networkId}' AND contract_address LIKE '${data.collectionAddress}' AND user_id = ${user.id} LIMIT 1`;
  const [collection] = await db.query(sql1);
  if (!collection[0]) {
    return null;
  }
  const sql2 = `UPDATE nfts SET is_draft = 0, status = ${NFT_STATUS.DONE}, token_id = '${tokenId}', hash_transaction='${txHash}', standard_type = ${NFT_STANDARD_TYPE.ERC_721} WHERE network_id = '${networkId}' AND collections_id = ${collection[0].id} AND ipfs_json LIKE '%${data.uri}' AND status = ${NFT_STATUS.PENDING}`;
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

module.exports = { run };
