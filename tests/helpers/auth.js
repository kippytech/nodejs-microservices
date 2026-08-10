const api = require("./client");

async function login() {
  const res = await api.post("/auth/login", {
    email: "daggy@gmail.com",
    password: "test123",
  });

  console.log("LOGIN RESPONSE:", res.status, res.data);

  expect(res.status).toBe(200);

  return res.data.accessToken;
}

module.exports = login;