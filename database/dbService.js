
var DB = "mongodb://xanaAdm:bnbethbtc@13.251.217.172:27017/?authSource=xanaliaTest"; //mainnet
const MongoClient = require('mongodb').MongoClient;
var DBName = "xanaliaDB";
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');
const { Client } = require('ssh2');
const sshClient = new Client();
const delay = require('delay');

const dbServer = {
  host: "stg-noborderz.cofwf0emvfdu.eu-west-1.rds.amazonaws.com",
  port: 3306,
  user: "nft_master",
  password: "nft#2021!668Pr0",
  database: "noborderzstg"
}
const tunnelConfig = {
  host: "52.16.154.84",
  port: 22,
  username: "ec2-user",
  // privateKey: fs.readFileSync('/home/ajlal/pem-files/stg-noborderz-basion.pem', 'utf-8')
  privateKey: fs.readFileSync('./database/stg-noborderz-basion.pem', 'utf-8')
}

const forwardConfig = {
  srcHost: '127.0.0.1',
  srcPort: 3306,
  dstHost: dbServer.host,
  dstPort: dbServer.port
};
var db;

async function mongoConnection() {
  const SSHConnection = new Promise((resolve, reject) => {
    sshClient.on('ready', () => {
      sshClient.forwardOut(
        forwardConfig.srcHost,
        forwardConfig.srcPort,
        forwardConfig.dstHost,
        forwardConfig.dstPort,
        async (err, stream) => {
          if (err) reject(err);
          const updatedDbServer = {
            ...dbServer,
            stream
          };
          db = await mysql.createConnection(updatedDbServer);
          
        });
    }).connect(tunnelConfig);
  });

  MongoClient.connect(DB, { useNewUrlParser: true, useUnifiedTopology: true }, async function (err, client) {
    if (err) { console.log(err); }
    // console.log(DBName)
    connectionMongo = await client.db(DBName);
    // console.log(db)
  });
}

exports.getDbConnection = async () => {
  try {
    db = await mongoConnection();
    await delay(3000);
    console.log(db)

    return db
  } catch (error) {
    console.log(
      '🚀 ~ file: dbService.js ~ line 15 ~ exports.getDbConnection= ~ error',
      error
    );
  }
};
