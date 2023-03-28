console.log("process.env.SOCKET_URL", process.env.SOCKET_URL);
var socket = require("socket.io-client")(
  process.env.SOCKET_URL || "http://localhost:4000"
);

async function sendToSocket(data, event) {
  try {
    console.log("sendToSocket::", data, event);
    socket.emit(event, { data });
  } catch (error) {
    console.log("sendToSocket::error", error);
  }
}

function createSocketData(
  fromUser,
  toUser,
  action,
  nftId,
  saleNftId,
  listAddress = []
) {
  return {
    fromUser: fromUser,
    toUser: toUser,
    action: action,
    nftId: nftId,
    saleNftId: saleNftId,
    listAddress: listAddress,
  };
}

module.exports = {
  sendToSocket,
  createSocketData,
};
