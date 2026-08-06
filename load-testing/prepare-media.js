const fs = require("fs/promises");
const path = require("path");
//const FormData = require("form-data");

const BASE_URL = "http://127.0.0.1:3000";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTYwYmU0OTVhMGVkZjAxMmJiZjc3ZWQiLCJ1c2VybmFtZSI6ImRhZ2d5IiwiaWF0IjoxNzg1MzM3MTk0LCJleHAiOjE3ODUzNDA3OTR9.5JzhG19nhIiFlHBFRVRvy18T4tGSwjqOPp3vwSEPMf4"

const IMAGE_PATH = path.join(__dirname, "test-image.png");
const OUTPUT_FILE = path.join(__dirname, "mediaIds.json");

// async function uploadMedia() {
//   const form = new FormData();

//   form.append(
//     "media",
//     fs.createReadStream(IMAGE_PATH)
//   );
// }

async function uploadMedia() {
  const imageBuffer = await fs.readFile(IMAGE_PATH);

  const form = new FormData();

  form.append(
    "file",
    new Blob([imageBuffer], {
      type: "image/png",
    }),
    "test-image.png"
  );

  const response = await fetch(
    `${BASE_URL}/v1/media/upload`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },

      body: form,
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const json = await response.json();

  return json.mediaId;
}

async function main() {
  const COUNT = 300;

  const mediaIds = [];

  console.log(`Uploading ${COUNT} images...`);

  for (let i = 0; i < COUNT; i++) {
    try {
      const id = await uploadMedia();

      mediaIds.push(id);

      console.log(`${i + 1}/${COUNT} uploaded`);
    } catch (err) {
      console.error(
        `Upload ${i + 1} failed`,
        err.response?.data || err.message
      );
    }
  }

  fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(mediaIds, null, 2)
  );

  console.log(
    `Saved ${mediaIds.length} media IDs to ${OUTPUT_FILE}`
  );
}

main();