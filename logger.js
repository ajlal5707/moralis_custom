var winston = require("winston");

var logger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp()),
  transports: [
    new winston.transports.Console({ json: true, timestamp: true }),
    new winston.transports.File({
      filename: __dirname + "/debug.log",
      json: true,
    }),
    new WinstonCloudWatch({
      level: "error",
      retentionInDays: 30,
      logGroupName: "nft-job-service",
      logStreamName: function () {
        // Spread log streams across dates as the server stays up
        return new Date().toISOString().split("T")[0];
      },
      awsRegion: "ap-southeast-1",
      jsonMessage: true,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.Console({ json: true, timestamp: true }),
    new winston.transports.File({
      filename: __dirname + "/exceptions.log",
      json: true,
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
