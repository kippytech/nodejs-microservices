const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const api = require("../helpers/client");
const login = require("../helpers/auth");
const waitFor = require("../helpers/waitFor");

jest.setTimeout(20000);

describe("Posts E2E", () => {
  let token;
  let mediaId;
  let postId;

  const uniqueContent = `jest-${Date.now()}`;

  beforeAll(async () => {
    token = await login();
  });

  test("Upload media", async () => {
    const form = new FormData();

    form.append(
      "file",
      fs.createReadStream(
        path.join(__dirname, "../fixtures/test-image.png")
      )
    );

    const res = await api.post(
      "/media/upload",
      form,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...form.getHeaders(),
        },
      }
    );

    expect(res.status).toBe(201);

    expect(res.data.success).toBe(true);

    expect(res.data.mediaId).toBeDefined();

    mediaId = res.data.mediaId;
  });

  test("Create post", async () => {
    const res = await api.post(
      "/posts/create-post",
      {
        content: uniqueContent,
        mediaIds: [mediaId],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    expect(res.status).toBe(201);

    expect(res.data.success).toBe(true);

    expect(res.data.post._id).toBeDefined();

    postId = res.data.post._id;
  });

  test("Post is indexed by Search Service", async () => {
    await waitFor(async () => {
        const res = await api.get("/search/posts", {
        params: {
            query: uniqueContent,
        },
        headers: {
            Authorization: `Bearer ${token}`,
        },
        });

        //console.log(res.data);

        const post = res.data.find(
        (p) => p.postId === postId
        );

        return post || false;
    });
  });

  test("Delete post", async () => {
    //console.log("b4 delete post>>", { mediaId, postId });
    const res = await api.delete(
      `/posts/${postId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    expect(res.status).toBe(200);

    expect(res.data.success).toBe(true);
  });

  test("Media should eventually be cleaned up after post deletion", async () => {
  const removed = await waitFor(async () => {
    try {
      const res = await api.get("/media/get", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return !res.data.result.some(
        (media) => media._id === mediaId
      );
    } catch (error) {
      if (
        error.response?.status === 404 &&
        error.response?.data?.message ===
          "Can't find any media for this user"
      ) {
        return true;
      }

      throw error;
    }
  });

  expect(removed).toBe(true);
});
});