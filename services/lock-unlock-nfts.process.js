require('dotenv').config();
// const MARKET_ABI = require("../abi/market_abi.json");
const XANALIA_Lock_Unlock_ABI = require('../abi/xanalia_lock_unlock_abi.json');
const socket = require('./socket.service');
const commonService = require('./common.service');
const {
    SALE_NFT_ACTION,
    SALE_NFT_STATUS,
} = require('../common/constant');

async function run(txHash, address, networks, db) {
    console.log(`CraftNFt: ${txHash}, network = ${networks[0].id}`);
    const web3 = commonService.getInstanceWeb3(networks[0]);
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    if (receipt) {

        console.log(receipt, address, txHash, networks, web3, db)
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
                XANALIA_Lock_Unlock_ABI,
                networks[0].xanalia_lock_contract
            );
            const [events, transaction] = await Promise.all([
                contractInstance.getPastEvents('Lock', {
                    fromBlock: receipt.blockNumber,
                    toBlock: receipt.blockNumber,
                }),
                web3.eth.getTransaction(txHash),
            ]);

            const [eventsunLock, transactionUnlock] = await Promise.all([
                contractInstance.getPastEvents('Unlock', {
                    fromBlock: receipt.blockNumber,
                    toBlock: receipt.blockNumber,
                }),
                web3.eth.getTransaction(txHash),
            ]);

            if (transaction.transactionIndex != null && events.length > 0) {

                let userAddress = events[0].returnValues[0]
                let collectionAddress = events[0].returnValues[1]

                const user = await commonService.getUserIdFromAddress(userAddress, db);
                let nft
                for (let i = 0; i < events.length; i++) {
                    nft = await updateSuccessMintNft(
                        events[i].returnValues[2],
                        collectionAddress,
                        user,
                        txHash,
                        networks[0].id,
                        events[i].event,
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
                            'externalLockCollNft'
                        );
                        await db.commit();
                        return false;
                    }

                    let input = { price: nft.price, orderId: nft.orderId, networkTokenId: networks[0].id, receiveToken: null, nullquantity: 1, token: null }

                    await addNewSaleNft(nft, input, txHash, db);

                }

                await Promise.all([
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
                        address: userAddress.toLowerCase(),
                    },
                    'externalLockCollNft'
                );

            } else if (transactionUnlock.transactionIndex != null && eventsunLock.length > 0) {

                let userAddress = eventsunLock[0].returnValues[0]
                let collectionAddress = eventsunLock[0].returnValues[1]

                const user = await commonService.getUserIdFromAddress(userAddress, db);
                let nft
                for (let i = 0; i < eventsunLock.length; i++) {
                    nft = await updateSuccessMintNft(
                        eventsunLock[i].returnValues[2],
                        collectionAddress,
                        user,
                        txHash,
                        networks[0].id,
                        eventsunLock[i].event,
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
                            'externalLockCollNft'
                        );
                        await db.commit();
                        return false;
                    }

                    let input = { price: nft.price, orderId: nft.orderId, networkTokenId: networks[0].id, receiveToken: null, nullquantity: 1, token: null }

                    await addNewSaleNftUnlock(nft, input, txHash, db);

                }

                await Promise.all([
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
                        address: userAddress.toLowerCase(),
                    },
                    'externalLockCollNft'
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
                    'externalLockCollNft'
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
    event,
    db

) {
    console.log("collection", tokenId,
        collectionAddress,
        user,
        txHash,
        networkId,);

    let lock = event === "Lock" ? 1 : 0
    const sql1 = `SELECT id FROM collections WHERE network_id = '${networkId}' AND contract_address LIKE '${collectionAddress}' ORDER BY id DESC LIMIT 1`;
    const [collection] = await db.query(sql1);
    console.log("collection", collection);
    if (!collection[0]) {
        return null;
    }
    const sql2 = `UPDATE nfts SET  is_lock='${lock}' WHERE network_id = '${networkId}' AND collections_id = ${collection[0].id} AND token_id = '${tokenId}'`;
    await db.query(sql2);
    const sql3 = `SELECT * FROM nfts WHERE token_id = '${tokenId}' AND collections_id = ${collection[0].id} ORDER BY id DESC LIMIT 1`;
    const [nft] = await db.query(sql3);
    if (nft.length === 0) return null;

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

    const sql = `INSERT INTO \`sale_nft\` (nft_id, from_user_id, to_user_id, price, quantity, action, status, tx_id, original_price, network_token_id) values 
            (${nft.id}, ${nft.user_id}, ${nft.user_id}, ${price}, 1, ${SALE_NFT_ACTION.lockUnlockNfts}, ${SALE_NFT_STATUS.NEW}, '${txHash}', ${originalPrice}, ${input.networkTokenId})`;

    const [result] = await db.query(sql);
    data.id = result.insertId;
    return data;
}

async function addNewSaleNftUnlock(nft, input, txHash, db) {
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
            (${nft.id}, ${nft.user_id}, ${nft.user_id}, ${price}, 1, ${SALE_NFT_ACTION.unlockNft}, ${SALE_NFT_STATUS.NEW}, '${txHash}', ${originalPrice}, ${input.networkTokenId})`;

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
