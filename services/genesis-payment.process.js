require('dotenv').config();
// const MARKET_ABI = require("../abi/market_abi.json");
const GENESIS_DEX_ABI = require('../abi/gensis_abi.json');
const socket = require('./socket.service');
const { convertWeiIntoPrice } = require('../common/helpers');
const commonService = require('./common.service');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  MARKET_STATUS,
} = require('../common/constant');
const axios = require('axios');

async function run(txHash, address, networks, db) {
  console.log(`EditOrder: ${txHash}, network = ${networks[0].id}`);
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

    console.log("params=========", receipt, address, txHash, networks)
    const checkTx = await commonService.checkTxIdExistedInSaleNft(txHash, db);

    if (!checkTx) {
      const contractInstance = new web3.eth.Contract(
        GENESIS_DEX_ABI,
        networks[0].xanaGenesisPaymentContract
      );
      const [events, transaction] = await Promise.all([
        contractInstance.getPastEvents('Paid', {
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        }),
        web3.eth.getTransaction(txHash),
      ]);
      if (transaction.transactionIndex != null && events.length > 0) {
        const currentEvent = events.find(
          (event) => event.transactionHash === txHash
        );
        const { returnValues } = currentEvent;

        const [input, user] = await Promise.all([
          parseInput(transaction.input, web3, db),
          commonService.getUserIdFromAddress(address, db),
        ]);

        let recieveTokenType = returnValues.token
        recieveTokenType = recieveTokenType === "0x0000000000000000000000000000000000000000" ? "ETH" : "USDT"
        const network = commonService.getNetworkTokenByReceiveToken(
          recieveTokenType,
          networks
        );

        input.price = Number(
          convertWeiIntoPrice(returnValues.amount, network.networkTokenDecimal)
        );

        let url = `https://api.coinconvert.net/convert/${recieveTokenType}/usd?amount=${input.price}`
        let response = await axios.get(url);

        let user_word = response.data.USD * 370

        user_word = Math.round(user_word * 10) / 10

        if (currentEvent) {
          await Promise.all([
            addGenesisPyament(
              user,
              input,
              db,
              txHash,
              user_word,
              recieveTokenType,
              address
            ),
            commonService.updateSuccessExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            ),
          ]);
          socket.sendToSocket(
            {
              txHash: txHash,
              result: true,
              address: address.toLowerCase(),
            },
            'genesisPayCoin'
          );
        } else {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            {
              saleInfo: saleInfo,
              txHash: txHash,
              result: false,
              address: address.toLowerCase(),
            },
            'genesisPayCoin'
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
        'genesisPayCoin'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('updateRemoveSaleData::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

async function addGenesisPyament(
  user,
  input,
  db,
  txHash,
  user_word,
  recieveTokenType,
  address
) {
  const data = {
    address: address,
    tokenType: recieveTokenType,
    words_limit: user_word,
    amount: input.price,
    userId: user.id,
    txHash
  };
  const sql = `insert into \`xana_genesis_payment\` (address, token_type, words_limit, amount, user_id, tx_hash) values 
            ('${data.address}','${data.tokenType}', ${data.words_limit}, ${data.amount}, ${data.userId}, '${txHash}')`;
  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

async function parseInput(input, web3, db) {
  const array = ['uint256', 'uint256'];
  input = input.slice(10, input.length);
  const result = web3.eth.abi.decodeParameters(array, input);
  return {
    orderId: Number(result[0]),
    price: result[1],
  };
}

module.exports = {
  run,
};
