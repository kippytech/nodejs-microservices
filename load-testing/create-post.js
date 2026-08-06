import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  // stages: [
  //   { duration: "15s", target: 5 },
  //   { duration: "30s", target: 10 },
  //   { duration: "15s", target: 0 },
  // ],
  stages: [
    { duration: "30s", target: 20 },
    { duration: "30s", target: 50 },
    { duration: "30s", target: 100 },
    { duration: "30s", target: 0 },
  ],
};

const BASE_URL = "http://host.docker.internal:3000";

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTYwYmU0OTVhMGVkZjAxMmJiZjc3ZWQiLCJ1c2VybmFtZSI6ImRhZ2d5IiwiaWF0IjoxNzg1MzMzMTk1LCJleHAiOjE3ODUzMzY3OTV9.zG_xR6UD6KPxoReQ_bXRexq9BF0PSyrXOIbGkai5CYo"

export default function () {
  const payload = JSON.stringify({
    content: "k6 performance test",
    mediaIds: [],
  });

  const params = {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  };

  const res = http.post(
    `${BASE_URL}/v1/posts/create-post`,
    payload,
    params
  );

  if (res.status !== 201) {
    console.log("Status:", res.status);
    console.log("Body:", res.body);
  }

  check(res, {
    //"status is 201": (r) => r.status === 201,
    "successful": (r) => r.status >= 200 && r.status < 300,
  });

  //sleep(1);
}

// docker run --rm `
// >> -v ${PWD}/load-testing:/scripts `
// >> grafana/k6 run /scripts/create-post.js

//db.serverStatus().connections
//db.currentOp()