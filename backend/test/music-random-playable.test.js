const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const { probePlayableUrl } = require("../routes/v2/music-cookie");

function listen(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            resolve({ server, url: `http://127.0.0.1:${address.port}/track.mp3` });
        });
    });
}

test("probe accepts only a 2xx/206 media response", async () => {
    const ok = await listen((_req, res) => {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.end("ok");
    });
    try {
        assert.equal(await probePlayableUrl(ok.url), true);
    } finally {
        ok.server.close();
    }

    const forbidden = await listen((_req, res) => {
        res.writeHead(403, { "X-AUTH-MSG": "auth failed - expired url" });
        res.end("expired");
    });
    try {
        assert.equal(await probePlayableUrl(forbidden.url), false);
    } finally {
        forbidden.server.close();
    }
});

test("probe treats network errors as not playable", async () => {
    const closed = await listen((_req, res) => res.end("closing"));
    const url = closed.url;
    await new Promise((resolve) => closed.server.close(resolve));
    assert.equal(await probePlayableUrl(url), false);
});
