import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = "http://host.docker.internal:3000";

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTYwYmU0OTVhMGVkZjAxMmJiZjc3ZWQiLCJ1c2VybmFtZSI6ImRhZ2d5IiwiaWF0IjoxNzg1MzM3MTk0LCJleHAiOjE3ODUzNDA3OTR9.5JzhG19nhIiFlHBFRVRvy18T4tGSwjqOPp3vwSEPMf4"

const postIds = JSON.parse(open("./postIds.json"));

export const options = {
    stages: [
        { duration: "15s", target: 5 },
        { duration: "30s", target: 10 },
        { duration: "15s", target: 0 },
    ],
};

export default function () {
    const TOTAL_VUS = 10;

    const id = postIds[(__VU - 1 + __ITER * TOTAL_VUS) % postIds.length]; //postIds[__ITER % postIds.length];

    console.log(`VU ${__VU} ITER ${__ITER} -> ${id}`);

    const res = http.del(
        `${BASE_URL}/v1/posts/${id}`,
        null,
        {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
            },
        }
    );

    if (res.status < 200 || res.status >= 300) {
        console.log(`Status: ${res.status}`);
        console.log(`Body: ${res.body}`);
    }

    check(res, {
        success: r => r.status >= 200 && r.status < 300,
    });

    sleep(1);
}