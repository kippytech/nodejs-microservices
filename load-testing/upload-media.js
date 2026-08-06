// USE prepare-media.js INSTEAD OF THIS COZ K6 IS LIMITED IN FILE CREATION
// A NODEJS SCRIPT IS BETTER COZ OF FS, FS/PROMISES, PATH


import http from "k6/http";
import { sleep } from "k6";

const BASE_URL = "http://host.docker.internal:3000";

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTYwYmU0OTVhMGVkZjAxMmJiZjc3ZWQiLCJ1c2VybmFtZSI6ImRhZ2d5IiwiaWF0IjoxNzg1MzI5MTA5LCJleHAiOjE3ODUzMzI3MDl9.iWvoRRPh8u12tSZhXia0MmL00YKWPmQTNfHM1HF0G8s"

export default function () {
    const img = open("./test-image.jpg", "b");

    const data = {
        media: http.file(img, "test-image.png", "image/jpeg"),
    };

    const res = http.post(
        `${BASE_URL}/v1/media/upload`,
        data,
        {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
            },
        }
    );

    console.log(res.body);

    sleep(1);
}