const axios = require("axios");

const api = axios.create({
  //baseURL: "http://127.0.0.1:3000/v1",
  baseURL: "http://api.local/v1",
  validateStatus: () => true,
});

module.exports = api;