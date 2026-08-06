import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = "http://host.docker.internal:3000";

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTYwYmU0OTVhMGVkZjAxMmJiZjc3ZWQiLCJ1c2VybmFtZSI6ImRhZ2d5IiwiaWF0IjoxNzg1MzM3MTk0LCJleHAiOjE3ODUzNDA3OTR9.5JzhG19nhIiFlHBFRVRvy18T4tGSwjqOPp3vwSEPMf4"

const mediaIds = JSON.parse(open("./mediaIds.json"));

export const options = {
    stages: [
        { duration: "15s", target: 5 },
        { duration: "30s", target: 10 },
        { duration: "15s", target: 0 },
    ],
};

export default function () {

    const payload = JSON.stringify({
        content: "Post with media",
        mediaIds,
    });

    const res = http.post(
        `${BASE_URL}/v1/posts/create-post`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
            },
        }
    );

    check(res, {
        success: r => r.status === 201,
    });

    if (res.status === 201) {
        console.log(res.body);
    }

    sleep(1);
}