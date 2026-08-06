const axios = require("axios");

jest.setTimeout(30000);

//const API_URL = "http://127.0.0.1:3000";
const API_URL = "http://api.local";

const credentials = {
  email: "daggy@gmail.com",
  password: "test123",
};

let token;

async function login() {
  const res = await axios.post(`${API_URL}/v1/auth/login`, credentials);

  token = res.data.accessToken;
}

function auth() {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

async function waitFor(fn, timeout = 20000, interval = 1000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await fn()) return true;

    await new Promise((r) => setTimeout(r, interval));
  }

  return false;
}

describe("Media Cleanup E2E", () => {
  beforeAll(async () => {
    await login();
  });

  it("should delete media after deleting its post", async () => {
    // 1. Upload media
    const FormData = require("form-data");
    const fs = require("fs");

    const form = new FormData();

    form.append(
      "file",
      fs.createReadStream("fixtures/test-image.png")
    );

    const uploadRes = await axios.post(
      `${API_URL}/v1/media/upload`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const mediaId = uploadRes.data.mediaId;

    // 2. Create post
    const postRes = await axios.post(
      `${API_URL}/v1/posts/create-post`,
      {
        content: "cleanup-test-post",
        mediaIds: [mediaId],
      },
      auth()
    );

    const postId = postRes.data.post._id;

    // 3. Delete post
    await axios.delete(
      `${API_URL}/v1/posts/${postId}`,
      auth()
    );

    // 4. Wait until media disappears
    const removed = await waitFor(async () => {
      const res = await axios.get(
        `${API_URL}/v1/media/get`,
        auth()
      );

      return !res.data.result.some(
        (m) => m._id === mediaId
      );
    });

    expect(removed).toBe(true);
  });
});

// npx jest tests/e2e/media-cleanup.e2e.test.js --runInBand