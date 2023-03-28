require('dotenv').config();
const socket = require('./socket.service');
const commonService = require('./common.service');
const { getInstanceWeb3 } = require('./common.service');
const {
  NFT_STANDARD_TYPE,
  NFT_STATUS,
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  NFT_TYPE,
  MARKET_STATUS,
} = require('../common/constant');
const {
  convertWeiIntoPrice,
  convertTotalPriceToOriginalPrice,
} = require('../common/helpers');
const XANALIA_DEX_ABI = require('../abi/xanalia_dex_abi.json');
async function run(txHash, address, networks, db) {
  console.log(
    `createNFT and putOnSale: ${txHash}, networks = ${networks[0].id}`
  );
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
      const contractInstance = new web3.eth.Contract(
        XANALIA_DEX_ABI,
        networks[0].xanalia_dex_contract
      );
      const [events, transaction] = await Promise.all([
        contractInstance.getPastEvents('OrderCreated', {
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        }),
        web3.eth.getTransaction(txHash),
      ]);
      if (transaction.transactionIndex != null && events.length > 0) {
        const currentEvent = events.find(
          (event) => event.transactionHash === txHash
        );
        if (!currentEvent) {
          return;
        }
        const { returnValues } = currentEvent;
        let input = parseInput(transaction.input, web3, networks);
        input.orderId = Number(returnValues._orderId);
        input.tokenId = Number(returnValues._tokenId);
        input.tokenAddress = returnValues._tokenAddress;

        const user = await commonService.getUserIdFromAddress(address, db);
        const nft = await updateSuccessMintNft(
          input.tokenId,
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

        const saleData = await addNewSaleNft(nft, input, txHash, db);

        await Promise.all([
          commonService.updateNft(
            nft.id,
            NFT_TYPE.SALE,
            1,
            nft.market,
            saleData.price,
            nft.receive_token,
            db,
            MARKET_STATUS.ON_FIX_PRICE
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
        console.log(`Transaction: ${txHash} pending`);
      }
    } else {
      await Promise.all([
        commonService.updateFailExternalTransaction(
          txHash,
          networks[0].moralis_transactions,
          db
        ),
        socket.sendToSocket(
          { txHash: txHash, result: false, address: address.toLowerCase() },
          'externalCreateNft'
        ),
      ]);
    }
    await db.commit();
  } catch (error) {
    console.log(error);
    await db.rollback();
    throw error;
  }
}

function parseInput(input, web3, networks) {
  const array = ['address', 'string', 'uint256', 'address', 'uint256'];
  input = input.slice(10, input.length);
  const data = web3.eth.abi.decodeParameters(array, input);
  const network = commonService.getNetworkToken(data[3], networks);

  return {
    collectionAddress: data[0],
    uri: data[1],
    royalty: data[2],
    paymentTokenAddress: data[3],
    price: Number(convertWeiIntoPrice(data[4], network.networkTokenDecimal)),
    networkTokenId: network.networkTokenId,
    token: network.networkTokenName,
  };
}

async function updateSuccessMintNft(
  tokenId,
  data,
  user,
  txHash,
  networkId,
  db
) {
  const sql1 = `SELECT id FROM collections WHERE network_id = '${networkId}' AND contract_address LIKE '${data.collectionAddress}' AND (user_id = ${user.id} or collections.type = 6) ORDER BY id DESC LIMIT 1`;
  const [collection] = await db.query(sql1);
  if (!collection[0]) {
    return null;
  }
  const sql2 = `UPDATE nfts SET status = ${NFT_STATUS.DONE}, token_id = '${tokenId}', hash_transaction='${txHash}', standard_type = ${NFT_STANDARD_TYPE.ERC_721} WHERE network_id = '${networkId}' AND collections_id = ${collection[0].id} AND ipfs_json LIKE '%${data.uri}' AND status = ${NFT_STATUS.PENDING}`;
  await db.query(sql2);
  const sql3 = `SELECT * FROM nfts WHERE token_id = '${tokenId}' AND collections_id = ${collection[0].id} ORDER BY id DESC LIMIT 1`;
  const [nft] = await db.query(sql3);
  if (nft.length === 0) return null;

  const sql4 =
    `INSERT INTO \`sale_nft\` (nft_id, from_user_id, to_user_id, quantity, action, status, tx_id) values ` +
    `(${nft[0].id}, ${user.id}, ${user.id}, ${nft[0].no_copy}, ${SALE_NFT_ACTION.MINT_NFT}, ${SALE_NFT_STATUS.SUCCESS}, '${txHash}')`;

  await Promise.all([
    db.query(sql4),
    commonService.newOwnerNft(nft[0].id, user.id, 1, db),
  ]);
  return nft[0];
}

async function addNewSaleNft(nft, input, txHash, db) {
  const price = input.price;
  const originalPrice = convertTotalPriceToOriginalPrice(
    input.price,
    nft.royalty,
    nft.platform_commission
  );

  let data = {
    id: null,
    nftId: nft.id,
    fromUserId: nft.user_id,
    toUserId: nft.user_id,
    orderId: input.orderId,
    price,
    originalPrice,
    networkTokenId: input.networkTokenId,
    receiveToken: input.token,
    quantity: input.quantity || 1,
  };

  const sql = `INSERT INTO \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, order_id, tx_id, original_price, network_token_id) values 
            (${nft.id}, ${nft.user_id}, ${nft.user_id}, ${price}, 1, ${SALE_NFT_ACTION.PUT_ON_SALE}, '${input.token}', ${SALE_NFT_STATUS.SUCCESS}, ${input.orderId}, '${txHash}', ${originalPrice}, ${input.networkTokenId})`;

  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

module.exports = { run };
