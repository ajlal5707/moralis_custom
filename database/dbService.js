require('dotenv').config();
const mysql = require('mysql2/promise');

exports.getDbConnection = async () => {
  try {
    const config = {
      database: process.env.DATABASE_NAME,
      host: process.env.MYSQL_HOST,
      port: process.env.MYSQL_PORT,
      user: process.env.MYSQL_USER,
      password: process.env.DATABASE_PASSWORD,
    };
    console.log(
      '🚀 ~ file: dbService.js ~ line 13 ~ exports.getDbConnection= ~ config',
      config
    );
    return await mysql.createConnection(config);
  } catch (error) {
    console.log(
      '🚀 ~ file: dbService.js ~ line 15 ~ exports.getDbConnection= ~ error',
      error
    );
  }
};
