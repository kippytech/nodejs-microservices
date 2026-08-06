const fs = require("fs/promises");
const path = require("path");

const BASE_URL = "http://127.0.0.1:3000";

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTYwYmU0OTVhMGVkZjAxMmJiZjc3ZWQiLCJ1c2VybmFtZSI6ImRhZ2d5IiwiaWF0IjoxNzg1MzM3MTk0LCJleHAiOjE3ODUzNDA3OTR9.5JzhG19nhIiFlHBFRVRvy18T4tGSwjqOPp3vwSEPMf4"

async function main() {
  const mediaIdsPath = path.join(__dirname, "mediaIds.json");

  const mediaIds = JSON.parse(
    await fs.readFile(mediaIdsPath, "utf8")
  );

  const postIds = [];

  // Create 100 posts
  for (let i = 0; i < 300; i++) {
    const response = await fetch(
      `${BASE_URL}/v1/posts/create-post`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          content: `Benchmark post ${i + 1}`,
          mediaIds,
        }),
      }
    );

    if (!response.ok) {
      console.error(
        `Failed creating post ${i + 1}:`,
        response.status
      );
      continue;
    }

    const json = await response.json();

    const id =
      json.post?._id ??
      json.data?._id ??
      json._id;

    if (!id) {
      console.warn("Couldn't find post id:", json);
      continue;
    }

    postIds.push(id);

    console.log(
      `Created ${i + 1}/100 -> ${id}`
    );
  }

  await fs.writeFile(
    path.join(__dirname, "postIds.json"),
    JSON.stringify(postIds, null, 2)
  );

  console.log(
    `Saved ${postIds.length} post ids to postIds.json`
  );
}

main().catch(console.error);