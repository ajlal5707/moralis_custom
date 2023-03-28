require('dotenv').config();
const commonService = require('./common.service');
const socket = require('./socket.service');
const {
  convertWeiIntoPrice,
  convertTotalPriceToOriginalPrice,
} = require('../common/helpers');
const XANALIA_RENT_ABI = require('../abi/xanalia_rent_abi.json');
const {
  SALE_NFT_STATUS,
  SALE_NFT_ACTION,
  MARKET_STATUS,
  NFT_STANDARD_TYPE,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
  console.log(`updatePutOnRentData: ${txHash}, networks = ${networks[0].id}`);
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

  console.log("enter in put on rent event")

  try {
    const checkTx = await commonService.checkTxIdExistedInSaleNft(txHash, db);
    if (!checkTx) {
      const contractInstance = new web3.eth.Contract(
        XANALIA_RENT_ABI,
        networks[0].rent_contract
      );
      const [events, transaction] = await Promise.all([
        contractInstance.getPastEvents('RentEvent', {
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
          let { _orderId } = returnValues;
          _orderId = Number(0);

          const input = parseInput(transaction.input, networks, web3);

          const nft = await commonService.getNftByTokenAndNetwork(
            returnValues._nftTokenId,
            returnValues._collection,
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
              'externalPutOnRent'
            );
            await db.commit();
            return false;
          }

          const user = await commonService.getUserIdFromAddress(address, db);

          if (events.length > 0) {
            let saleNft = await addNewSaleNft(
              nft,
              input,
              user.id,
              db,
              _orderId,
              txHash,
              input.networkTokenId
            );

            await Promise.all([
              updateNftData(nft, saleNft, user, db),
              commonService.updateSuccessExternalTransaction(
                txHash,
                networks[0].moralis_transactions,
                db
              ),
            ]);
            socket.sendToSocket(
              {
                saleNft: saleNft,
                txHash: txHash,
                result: true,
                address: address.toLowerCase(),
              },
              'externalPutOnRent'
            );
          } else {
            await commonService.updateFailExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            );
            socket.sendToSocket(
              {
                saleNft: null,
                txHash: txHash,
                result: false,
                address: address.toLowerCase(),
              },
              'externalPutOnRent'
            );
          }
        } else {
          await commonService.updateFailExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          );
          socket.sendToSocket(
            { txHash: txHash, result: false, address: address.toLowerCase() },
            'externalPutOnRent'
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
        'externalPutOnRent'
      );
    }
    await db.commit();
  } catch (error) {
    console.log('externalPutOnRent::Error');
    console.log(error);
    await db.rollback();
    throw error;
  }
}

function parseInput(input, networks, web3) {
  try {
    const array = ['address', 'uint256', 'uint256', 'uint256'];
    input = input.slice(10, input.length);
    paymtToken = "0x0000000000000000000000000000000000000000";
    const result = web3.eth.abi.decodeParameters(array, input);
    const network = commonService.getNetworkToken(paymtToken, networks);

    return {
      tokenAddress: result[0],
      paymentToken: paymtToken,
      tokenId: Number(result[1]),
      price: Number(convertWeiIntoPrice(result[3], network.networkTokenDecimal)),
      networkTokenId: network.networkTokenId,
      token: network.networkTokenName,
    };
  } catch(err) {
    console.log(err)
  }
}

async function addNewSaleNft(
  nft,
  input,
  userId,
  db,
  orderId,
  txHash,
  networkTokenId,
  status = SALE_NFT_STATUS.SUCCESS
) {
  const originalPrice = convertTotalPriceToOriginalPrice(
    input.price,
    nft.royalty,
    nft.platform_commission
  );

  let data = {
    id: null,
    nftId: nft.id,
    fromUserId: userId,
    toUserId: userId,
    price: input.price,
    orderId: orderId,
    originalPrice,
    networkTokenId,
    receiveToken: input.token,
    quantity: input.quantity || 1,
  };

  const sql = `INSERT INTO \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, receive_token, status, order_id, tx_id, original_price, network_token_id) values 
            (${nft.id}, ${userId}, ${userId}, ${data.price}, ${data.quantity}, ${SALE_NFT_ACTION.PUT_ON_RENT}, '${input.token}', ${status}, ${orderId}, '${txHash}', ${data.originalPrice}, ${networkTokenId})`;

  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

async function updateNftData(nft, saleNft, user, db) {
  let countQuantity = await commonService.getRemainingQuantity(nft.id, db);

  let market = nft.market;
  if (market === 0) {
    market = user.user_type === 2 ? 2 : 1;
  }
  let type = nft.type;

  if (nft.type == 2) {
    countQuantity = nft.quantity;
  }

  await commonService.updateNft(
    nft.id,
    type,
    1,
    market,
    saleNft.price,
    saleNft.receiveToken,
    db,
    MARKET_STATUS.ON_RENT
  );
}

module.exports = {
  run,
};
