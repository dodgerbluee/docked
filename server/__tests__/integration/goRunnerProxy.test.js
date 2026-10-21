/**
 * Tests for the Node→Go runner route bridge (utils/goRunnerProxy.js).
 *
 * The dockhand agent protocol and enrollment endpoints moved to the Go
 * backend; Node keeps the edge limiters and forwards. These tests pin the
 * forwarding contract: original URL, Authorization passthrough, Cookie
 * passthrough (OAuth state cookies), XFF
 * overwrite (never append), X-Forwarded-Proto/Host for Go's URL builder,
 * JSON body re-serialization, streaming response passthrough, upstream
 * teardown on client disconnect, and the 502 envelope when the Go backend
 * is unreachable.
 */

const http = require("http");
const express = require("express");
const request = require("supertest");
const { createGoRunnerProxy } = require("../../utils/goRunnerProxy");

describe("goRunnerProxy bridge", () => {
  let upstream;
  let upstreamPort;
  let seen; // captured requests: { method, url, headers, body }
  let upstreamMode; // "ok" | "script" | "fail" | "sse"
  let upstreamClosed; // set when an SSE-mode upstream stream ends prematurely

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
        if (upstreamMode === "sse") {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("event: tick\ndata: {}\n\n");
          const timer = setInterval(() => res.write(": keepalive\n\n"), 50);
          res.on("close", () => {
            clearInterval(timer);
            if (!res.writableEnded) upstreamClosed = true;
          });
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

  beforeEach(() => {
    seen = [];
    upstreamMode = "ok";
    upstreamClosed = false;

    const plain = createGoRunnerProxy();

    app = express();
    app.use(express.json());
    app.get("/api/runners/install/:token", plain);
    app.get("/api/runners/enrollment-status", plain);
    app.post("/api/runners/register", plain);
    app.post("/api/runners/heartbeat", plain);
    app.post("/api/runners/:runnerId/containers/:containerId/upgrade", plain);
    app.get("/api/avatars", plain);
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

  it("forwards the Cookie header (OAuth state cookies ride the SSO flows)", async () => {
    await request(app)
      .get("/api/avatars")
      .set("Cookie", "oauth_state=xyz; other=1")
      .expect(200);
    expect(seen[0].headers.cookie).toBe("oauth_state=xyz; other=1");
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

  it("destroys the upstream stream when the browser disconnects mid-SSE", async () => {
    // The upgrade SSE route holds a cross-process lock for the stream's
    // lifetime; Go only releases it when its request context cancels, which
    // requires the bridge to tear the upstream down on client disconnect.
    upstreamMode = "sse";

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const client = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: server.address().port,
            path: "/api/runners/1/containers/abc/upgrade",
            method: "POST",
          },
          (res) => {
            res.once("data", () => resolve(req));
            res.on("error", reject);
          }
        );
        req.on("error", () => {}); // expected once we destroy mid-stream
        req.end();
      });

      client.destroy(); // the browser hangs up mid-stream

      const deadline = Date.now() + 3000;
      while (!upstreamClosed && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(upstreamClosed).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
