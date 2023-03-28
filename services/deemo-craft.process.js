require('dotenv').config();
// const MARKET_ABI = require("../abi/market_abi.json");
const XANALIA_CRAFT_ABI = require('../abi/xanalia_craft_abi.json');
const socket = require('./socket.service');
const { convertWeiIntoPrice } = require('../common/helpers');
const commonService = require('./common.service');
const {
  SALE_NFT_ACTION,
  SALE_NFT_STATUS,
  MARKET_STATUS,
  NFT_STATUS
} = require('../common/constant');
const axios = require('axios');

async function run(txHash, address, networks, db) {
  console.log(`CraftNFt: ${txHash}, network = ${networks[0].id}`);
  const web3 = commonService.getInstanceWeb3(networks[0]);
  const receipt = await web3.eth.getTransactionReceipt(txHash);
  if (receipt) {

    // console.log(receipt, address, txHash, networks, web3, db)
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
    console.log("INNNNN")
    const checkTx = await commonService.checkTxIdExistedInNft(txHash, db);
    if (!checkTx) {
      const contractInstance = new web3.eth.Contract(
        XANALIA_CRAFT_ABI,
        networks[0].deemoContract
      );
      const [events, transaction] = await Promise.all([
        contractInstance.getPastEvents('CraftNFT', {
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
        // const { returnValues } = currentEvent;

        // console.log(returnValues)

        // let input = parseInput(transaction.input, web3, networks);
        // input.orderId = Number(returnValues._orderId);
        // input.tokenId = Number(returnValues._tokenId);
        // input.tokenAddress = returnValues._tokenAddress;

        let collectionAddress = currentEvent.address
        // let txHash = currentEvent.transactionHash
        let mintedId = currentEvent.returnValues[0];
        let craftNftIds = currentEvent.returnValues[1]
        let userAddress = currentEvent.returnValues[2]

        console.log(collectionAddress, craftNftIds, userAddress);
        const user = await commonService.getUserIdFromAddress(userAddress, db);
        let nft
        // console.log(user)
        // console.log(collectionAddress)
        // console.log(txHash)
        // console.log(craftNftIds)
        // console.log(userAddress)
        for (let i = 0; i < craftNftIds.length; i++) {
           nft = await updateSuccessMintNft(
            craftNftIds[i],
            collectionAddress,
            user,
            txHash,
            networks[0].id,
            db
          );
          console.log("nft", nft);
          if (!nft) {
            await commonService.updateFailExternalTransaction(
              txHash,
              networks[0].moralis_transactions,
              db
            );
            socket.sendToSocket(
              { txHash: txHash, result: false, address: address.toLowerCase() },
              'externalCraftNft'
            );
            await db.commit();
            return false;
          }

          let input = { price: nft.price, orderId: nft.orderId, networkTokenId: networks[0].id, receiveToken: null, nullquantity: 1, token: null }

          const saleData = await addNewSaleNft(nft, input, txHash, db);
        }

        let insertMintId = await insertSuccessMintNft(
            mintedId,
            collectionAddress,
            user,
            txHash,
            networks[0].id,
            db
          );

        await Promise.all([
          commonService.updateSuccessExternalTransaction(
            txHash,
            networks[0].moralis_transactions,
            db
          ),
        ]);
        socket.sendToSocket(
          {
            nft: insertMintId,
            txHash: txHash,
            result: true,
            address: userAddress.toLowerCase(),
          },
          'externalCraftNft'
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
          'externalCraftNft'
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

async function updateSuccessMintNft(
  tokenId,
  collectionAddress,
  user,
  txHash,
  networkId,
  db

) {
  console.log("collection",tokenId,
  collectionAddress,
  user,
  txHash,
  networkId,);
  const sql1 = `SELECT id FROM collections WHERE network_id = '${networkId}' AND contract_address LIKE '${collectionAddress}' ORDER BY id DESC LIMIT 1`;
  const [collection] = await db.query(sql1);
  console.log("collection",collection);
  if (!collection[0]) {
    return null;
  }
  const sql2 = `UPDATE nfts SET is_draft=1, status = ${NFT_STATUS.PENDING}, market_status = '${NFT_STATUS.PENDING}', hash_transaction='${txHash}' WHERE network_id = '${networkId}' AND collections_id = ${collection[0].id} AND token_id = '${tokenId}'`;
  await db.query(sql2);
  const sql3 = `SELECT * FROM nfts WHERE token_id = '${tokenId}' AND collections_id = ${collection[0].id} ORDER BY id DESC LIMIT 1`;
  const [nft] = await db.query(sql3);
  if (nft.length === 0) return null;

  return nft[0];
}

async function insertSuccessMintNft(
  tokenId,
  collectionAddress,
  user,
  txHash,
  networkId,
  db

) {

  const sql1 = `SELECT id, user_id FROM collections WHERE network_id = '${networkId}' AND contract_address LIKE '${collectionAddress}' ORDER BY id DESC LIMIT 1`;
  const [collection] = await db.query(sql1);
  console.log("collection",collection);
  if (!collection[0]) {
    return null;
  }

  // const date = new Date(data.block_timestamp.iso);
  const timestamp = new Date().getTime();
  console.log("timestamp", timestamp);
  var dateFinal = new Date(timestamp);
  console.log("dateFinal", dateFinal);
  let data = {
    metaData: {
      "name": "DEEMO THE MOVIE NFT (Rare)",
      "description": "DEEMO, the popular music game with 28 million downloads worldwide, has been made into a movie. The movie`s memorial scenes and music can be owned as NFT.",
      "thumbnft": "https://xanalia.s3.ap-southeast-1.amazonaws.com/deemo/deemo_nft.jpg",
      "image": "https://xanalia.s3.ap-southeast-1.amazonaws.com/deemo/deemo_nft.jpg",
    },
    collectionCreatorId: collection[0].user_id,
    collectionId: collection[0].id,
    networkId: 1,
    finaliseDate: dateFinal.getFullYear()+"-"+(dateFinal.getMonth()+1)+"-"+dateFinal.getDate()+" "+dateFinal.getHours()+":"+dateFinal.getMinutes()+":"+dateFinal.getSeconds()+".000000",
    tokenId: parseInt(tokenId)-1,
    transactionHash: txHash,
    nftCategoryId: 2,
  };

  const insertNftQuery = `INSERT INTO \`nfts\` (name, is_draft, description, royalty, no_copy, small_image, large_image, created_at, updated_at, user_id, collections_id, market, status, market_status, quantity, price, token_id, type, on_farm_status, on_sale_status, hash_transaction, pumpkin, file_extension, preview_image, standard_type, is_feature, platform_commission, network_id, is_auction, min_start_price, category, is_migrated) values ('${data.metaData.name}', '0', '${data.metaData.description}', '0', '1', '${data.metaData.thumbnft}', '${data.metaData.image}', '${data.finaliseDate}', '${data.finaliseDate}', '${data.collectionCreatorId}', '${data.collectionId}', '1', '1', '0', '1', '0.000000', '${data.tokenId}', '0', '0', '0', '${data.transactionHash}', '0', '', '${data.metaData.thumbnft}', '1', '0', '0.00', '${data.networkId}', '0', '0.0000000000', '${data.nftCategoryId}', '1')`;
  console.log("-- NftQuery ---", insertNftQuery);
  const [result] = await db.query(insertNftQuery);
  console.log("*** NftQuery result ****", result.insertId)
  if(result.insertId) {
    var _nftId = result.insertId;
    if(user) {
      const insertMintTradeQuery = `INSERT INTO \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, pending_quantity, success_quantity, action, status, expired, raw_transaction_id, order_id, created_at, tx_id, influencer, influencer_fee, network_token_id, bid_id) VALUES ('${_nftId}', '${data.collectionCreatorId}', '${user.id}', '0.000000', '1', '0', '0', '15', '1', '0', '0', '0', '${data.finaliseDate}', '${data.transactionHash}', '0x0000000000000000000000000000000000000000', '0', '${data.networkId}', '0')`;
      console.log("-- MintTradeQuery ---", insertMintTradeQuery);
      let [saleNft] = await db.query(insertMintTradeQuery);
      console.log("*** MintTradeQuery result ****", saleNft.insertId);

      const insertOwnerTradeQuery = `INSERT INTO \`owner_nft\` (sale_total, farm_total, user_id, nfts_id) VALUES ('1', '0', '${user.id}', '${_nftId}')`;
      console.log("-- OwnerTradeQuery ---", insertOwnerTradeQuery);
      let [ownerNft] = await db.query(insertOwnerTradeQuery);
      console.log("*** OwnerTradeQuery result ****", ownerNft.insertId);
    }

    checkRarityType = data.metaData.name.replace("DEEMO THE MOVIE NFT ", "");
    console.log("checkRarityType", checkRarityType);
    let nftRarity;
    if(checkRarityType == '(Rare)') {
      nftRarity = "Rare";
    } else if(checkRarityType == '(Common)') {
      nftRarity = "Common";
    }
    console.log("nftRarity", nftRarity);
    let _rarityStatus = nftRarity.toLowerCase();

    const selectionQuery1 = `SELECT * FROM \`blind_box_meta_info\` WHERE \`status\`='0' and \`rarity\`='${_rarityStatus}' ORDER BY RAND() LIMIT 1`;
    console.log("-- selectionQuery --", selectionQuery1);
    let [result1] = await db.query(selectionQuery1);
    console.log("*** selectionQuery ***", result1);

    if(result1[0] && result1[0].id) {
      //update metaData
      const updateMetaDataNFTQuery = `update \`nfts\` SET \`category\` = '4', \`small_image\`='${result1[0].thumb_url}', \`large_image\`='${result1[0].main_url}' , \`preview_image\`='${result1[0].thumb_url}' WHERE \`id\`='${_nftId}'`;
      console.log("-- updateMetaDataNFTQuery ---", updateMetaDataNFTQuery);
      let [updateMetaDataNFT] = await db.query(updateMetaDataNFTQuery);
      console.log("*** updateMetaDataNFT result ****", updateMetaDataNFT.affectedRows);


      const updateMetaDataIdQuery = `update \`blind_box_meta_info\` SET \`status\`=1, \`nft_id\`='${_nftId}' WHERE \`id\`='${result1[0].id}'`;
      console.log("-- updateMetaDataIdQuery ---", updateMetaDataIdQuery);
      let [updateMetaData] = await db.query(updateMetaDataIdQuery);
      console.log("*** updateMetaData result ****", updateMetaData.affectedRows);
    }

    return parseInt(tokenId)-1;
  }
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

  const sql = `INSERT INTO \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, status, tx_id, original_price, network_token_id) values 
            (${nft.id}, ${nft.user_id}, ${nft.user_id}, ${price}, 1, ${SALE_NFT_ACTION.deemoCraftNfts}, ${SALE_NFT_STATUS.NEW}, '${txHash}', ${originalPrice}, ${input.networkTokenId})`;

  const [result] = await db.query(sql);
  data.id = result.insertId;
  return data;
}

function convertTotalPriceToOriginalPrice(
  price,
  royalty = 0,
  platformCommission = 0
) {
  return (
    Number(price) /
    (1 + Number(platformCommission) / 100 + Number(royalty) / 100)
  );
}

module.exports = {
  run,
};
