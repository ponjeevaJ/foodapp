const { createServer } = require("../src/server");

const apiServer = createServer();

module.exports = (request, response) => {
  apiServer.emit("request", request, response);
};
