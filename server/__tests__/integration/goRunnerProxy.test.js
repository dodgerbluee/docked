/**
 * Tests for the Node→Go runner route bridge (utils/goRunnerProxy.js).
 *
 * The dockhand agent protocol and enrollment endpoints moved to the Go
 * backend; Node keeps the edge limiters and forwards. These tests pin the
 * forwarding contract: original URL, Authorization passthrough, XFF
 * overwrite (never append), X-Forwarded-Proto/Host for Go's URL builder,
 * JSON body re-serialization, streaming response passthrough, the
 * preflight/onUpstream2xx heartbeat bridge hooks, and the 502 envelope when
 * the Go backend is unreachable.
 */

const http = require("http");
const express = require("express");
const request = require("supertest");
const { createGoRunnerProxy } = require("../../utils/goRunnerProxy");

describe("goRunnerProxy bridge", () => {
  let upstream;
  let upstreamPort;
  let seen; // captured requests: { method, url, headers, body }
  let upstreamMode; // "ok" | "script" | "fail"

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        if (upstreamMode === "fail") {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end('{"success":false,"error":"upstream boom"}');
          return;
        }
        if (upstreamMode === "script") {
          res.writeHead(200, { "Content-Type": "text/x-shellscript" });
          res.end("#!/usr/bin/env bash\necho hi\n");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, echo: seen[seen.length - 1].body }));
      });
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamPort = upstream.address().port;
    process.env.GRAPHQL_BACKEND = `http://127.0.0.1:${upstreamPort}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => upstream.close(resolve));
  });

  let app;
  let bridgeEvents;

  beforeEach(() => {
    seen = [];
    upstreamMode = "ok";
    bridgeEvents = [];

    const plain = createGoRunnerProxy();
    const heartbeat = createGoRunnerProxy({
      preflight: (req) => ({ storedUrl: "http://old:7777", runnerId: 7 }),
      onUpstream2xx: (req, proxyRes, info) =>
        bridgeEvents.push({ phase: "2xx", body: req.body, info, status: proxyRes.statusCode }),
    });

    app = express();
    app.use(express.json());
    app.get("/api/runners/install/:token", plain);
    app.get("/api/runners/enrollment-status", plain);
    app.post("/api/runners/register", plain);
    app.post("/api/runners/heartbeat", heartbeat);
  });

  it("forwards GET with query string, Authorization, and safe forwarding headers", async () => {
    const res = await request(app)
      .get("/api/runners/enrollment-status?token=abc")
      .set("Authorization", "Bearer jwt-123")
      .set("X-Forwarded-For", "9.9.9.9") // spoofable client prefix — must be overwritten
      .expect(200);

    expect(res.headers["content-type"]).toMatch(/application\/json/);

    expect(seen).toHaveLength(1);
    const fwd = seen[0];
    expect(fwd.method).toBe("GET");
    expect(fwd.url).toBe("/api/runners/enrollment-status?token=abc");
    expect(fwd.headers.authorization).toBe("Bearer jwt-123");
    expect(fwd.headers["x-forwarded-for"]).not.toContain("9.9.9.9");
    expect(fwd.headers["x-forwarded-for"]).toBeTruthy();
    expect(fwd.headers["x-forwarded-proto"]).toBe("http");
    expect(fwd.headers["x-forwarded-host"]).toBeTruthy();
    expect(fwd.body).toBe("");
  });

  it("re-serializes the parsed JSON body for POSTs", async () => {
    const res = await request(app)
      .post("/api/runners/register")
      .send({ token: "t", name: "box", url: "http://10.0.0.1:7777", apiKey: "k" })
      .expect(200);

    expect(seen).toHaveLength(1);
    const forwarded = JSON.parse(seen[0].body);
    expect(forwarded).toEqual({
      token: "t",
      name: "box",
      url: "http://10.0.0.1:7777",
      apiKey: "k",
    });
    expect(seen[0].headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.success).toBe(true);
  });

  it("passes through non-JSON upstream responses untouched (install script)", async () => {
    upstreamMode = "script";
    const res = await request(app)
      .get("/api/runners/install/" + "ab".repeat(32))
      .expect(200);
    expect(res.headers["content-type"]).toBe("text/x-shellscript");
    expect(res.text).toBe("#!/usr/bin/env bash\necho hi\n");
  });

  it("preserves upstream error statuses", async () => {
    upstreamMode = "fail";
    const res = await request(app).post("/api/runners/register").send({}).expect(500);
    expect(res.body).toEqual({ success: false, error: "upstream boom" });
  });

  it("runs preflight + onUpstream2xx on success but not on upstream failure", async () => {
    const res = await request(app)
      .post("/api/runners/heartbeat")
      .send({ apiKey: "k1", url: "http://10.0.0.9:7777/" })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(bridgeEvents).toHaveLength(1);
    expect(bridgeEvents[0].info).toEqual({ storedUrl: "http://old:7777", runnerId: 7 });
    expect(bridgeEvents[0].body).toEqual({ apiKey: "k1", url: "http://10.0.0.9:7777/" });

    upstreamMode = "fail";
    bridgeEvents.length = 0;
    await request(app)
      .post("/api/runners/heartbeat")
      .send({ apiKey: "k1", url: "http://x:1" })
      .expect(500);
    expect(bridgeEvents).toHaveLength(0);
  });

  it("returns a 502 JSON envelope when the Go backend is unreachable", async () => {
    const dead = createGoRunnerProxy();
    const deadApp = express();
    deadApp.use(express.json());
    deadApp.post("/api/runners/register", dead);

    const prev = process.env.GRAPHQL_BACKEND;
    process.env.GRAPHQL_BACKEND = "http://127.0.0.1:1"; // nothing listening
    try {
      const res = await request(deadApp).post("/api/runners/register").send({ token: "t" });
      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Go backend unavailable");
    } finally {
      process.env.GRAPHQL_BACKEND = prev;
    }
  });
});
