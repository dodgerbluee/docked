// Integration tests for the GraphQL WebSocket upgrade bridge. These exercise
// the raw http.Server "upgrade" path — which bypasses Express — against a
// stand-in upstream: successful upgrades, rejected upgrades with both
// Content-Length and chunked bodies (framing must survive), and X-Forwarded-For
// sanitization (the bridge must OVERWRITE the header with the validated client
// identity, never forward a spoofed value or an undefined req.ip).
const http = require("http");
const net = require("net");
const { attachGraphqlWsProxy, wsClientIp } = require("../../utils/graphqlWsProxy");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeServer(server) {
  // A bridged upgrade keeps both sockets open; close() alone would wait for
  // them forever.
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

// Send a raw upgrade request and collect the response. Resolves when the
// accumulated bytes contain stopOn (successful upgrades keep the socket open,
// so waiting for close would hang) or when the socket closes (rejections).
function rawUpgrade(port, extraHeaders = {}, stopOn = null) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("latin1"));
      socket.destroy();
    };
    socket.on("data", (c) => {
      chunks.push(c);
      if (stopOn && Buffer.concat(chunks).toString("latin1").includes(stopOn)) finish();
    });
    socket.on("close", finish);
    socket.on("error", reject);
    const headerLines = Object.entries({
      host: `127.0.0.1:${port}`,
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      ...extraHeaders,
    });
    socket.write(
      `GET /graphql HTTP/1.1\r\n${headerLines.map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`
    );
  });
}

describe("graphql WS upgrade proxy", () => {
  let upstream;
  let proxy;

  afterEach(async () => {
    if (proxy) await closeServer(proxy);
    if (upstream) await closeServer(upstream);
    proxy = undefined;
    upstream = undefined;
  });

  it("bridges a successful upgrade end to end", async () => {
    upstream = http.createServer();
    upstream.on("upgrade", (req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
      );
      socket.write("FRAME-FROM-UPSTREAM");
      // After an "upgrade" event the HTTP server's automatic half-close
      // handling is detached, so a peer FIN only fires "end". A real WS
      // server (like the Go backend) tears down on that; the stand-in must
      // too, or its socket stays half-open and server.close() hangs.
      socket.on("end", () => socket.destroy());
    });
    const upstreamPort = await listen(upstream);

    proxy = http.createServer();
    attachGraphqlWsProxy(proxy, {
      backendUrl: `http://127.0.0.1:${upstreamPort}`,
      trustProxy: false,
    });
    const proxyPort = await listen(proxy);

    const response = await rawUpgrade(proxyPort, {}, "FRAME-FROM-UPSTREAM");
    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("sec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    expect(response).toContain("FRAME-FROM-UPSTREAM");
  });

  it("replays client head bytes to the upstream (first WS frame not lost)", async () => {
    // A graphql-ws client that sends connection_init immediately after the
    // upgrade request gets those frame bytes buffered into `head` on the
    // upgrade event. They are consumed from the socket, so the bridge must
    // write them to the upstream BEFORE piping — otherwise the Go transport
    // never sees the first frame and the connection stalls until a timeout.
    let upstreamReceived = "";
    upstream = http.createServer();
    upstream.on("upgrade", (req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
      );
      socket.on("data", (c) => {
        upstreamReceived += c.toString("latin1");
      });
      socket.on("end", () => socket.destroy());
    });
    const upstreamPort = await listen(upstream);

    proxy = http.createServer();
    attachGraphqlWsProxy(proxy, {
      backendUrl: `http://127.0.0.1:${upstreamPort}`,
      trustProxy: false,
    });
    const proxyPort = await listen(proxy);

    // Headers + payload in ONE write: the payload lands in `head`.
    const client = net.connect(proxyPort, "127.0.0.1");
    client.write(
      `GET /graphql HTTP/1.1\r\nhost: x\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\nCONNECTION_INIT_FRAME`
    );
    const handshake = await new Promise((resolve, reject) => {
      const chunks = [];
      client.on("data", (c) => {
        chunks.push(c);
        const text = Buffer.concat(chunks).toString("latin1");
        if (text.includes("101 Switching Protocols")) resolve(text);
      });
      client.on("error", reject);
    });
    expect(handshake).toContain("101 Switching Protocols");

    // Give the replayed frame time to reach the upstream, then send another
    // frame over the piped connection to prove ordering does not break.
    await new Promise((r) => setTimeout(r, 100));
    client.write("LATER_FRAME");
    await new Promise((r) => setTimeout(r, 100));
    expect(upstreamReceived).toBe("CONNECTION_INIT_FRAMELATER_FRAME");
    client.destroy();
  });

  it("relays a rejected upgrade with its full Content-Length body and overwrites XFF", async () => {
    let seenXff;
    upstream = http.createServer((req, res) => {
      seenXff = req.headers["x-forwarded-for"];
      const body = JSON.stringify({ errors: [{ message: "too many requests; please slow down" }] });
      res.writeHead(429, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    });
    const upstreamPort = await listen(upstream);

    proxy = http.createServer();
    attachGraphqlWsProxy(proxy, {
      backendUrl: `http://127.0.0.1:${upstreamPort}`,
      trustProxy: false,
    });
    const proxyPort = await listen(proxy);

    // Client tries to spoof its identity; the bridge must replace XFF with
    // the validated peer (127.0.0.1), not forward the spoofed prefix.
    const response = await rawUpgrade(proxyPort, { "x-forwarded-for": "1.2.3.4" });

    expect(response).toMatch(/^HTTP\/1\.1 429/);
    expect(seenXff).toBe("127.0.0.1");
    // Framing must be intact: the advertised Content-Length must match the
    // body actually delivered (the old bridge advertised it and sent zero
    // body bytes).
    const match = response.match(/content-length: (\d+)/i);
    expect(match).not.toBeNull();
    const headerEnd = response.indexOf("\r\n\r\n");
    const body = response.slice(headerEnd + 4);
    expect(Buffer.byteLength(body)).toBe(Number(match[1]));
    expect(JSON.parse(body).errors[0].message).toContain("too many requests");
  });

  it("relays a rejected upgrade with a chunked body", async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.write('{"errors":[');
      res.write('{"message":"too many requests"}');
      res.end("]}");
    });
    const upstreamPort = await listen(upstream);

    proxy = http.createServer();
    attachGraphqlWsProxy(proxy, {
      backendUrl: `http://127.0.0.1:${upstreamPort}`,
      trustProxy: false,
    });
    const proxyPort = await listen(proxy);

    const response = await rawUpgrade(proxyPort);
    expect(response).toMatch(/^HTTP\/1\.1 429/);
    // The bridge buffers the (de-chunked) body and re-frames with an exact
    // Content-Length, so the client sees a complete, parseable response.
    expect(response).not.toMatch(/transfer-encoding: chunked/i);
    const headerEnd = response.indexOf("\r\n\r\n");
    const body = response.slice(headerEnd + 4);
    const cl = response.match(/content-length: (\d+)/i);
    expect(cl).not.toBeNull();
    expect(Buffer.byteLength(body)).toBe(Number(cl[1]));
    expect(JSON.parse(body).errors[0].message).toBe("too many requests");
  });

  it("forwards the rightmost incoming XFF entry when trust-proxy is on", async () => {
    let seenXff;
    upstream = http.createServer((req, res) => {
      seenXff = req.headers["x-forwarded-for"];
      res.writeHead(429, { "content-length": "2" });
      res.end("{}");
    });
    const upstreamPort = await listen(upstream);

    proxy = http.createServer();
    attachGraphqlWsProxy(proxy, {
      backendUrl: `http://127.0.0.1:${upstreamPort}`,
      trustProxy: true,
    });
    const proxyPort = await listen(proxy);

    await rawUpgrade(proxyPort, { "x-forwarded-for": "1.2.3.4, 203.0.113.9" });
    expect(seenXff).toBe("203.0.113.9");
  });

  it("survives a client reset while the upstream handshake is pending", async () => {
    // The client socket's "error" handler must be installed BEFORE the
    // upstream handshake resolves: a reset during the pending window emits
    // ECONNRESET on it, and an unhandled "error" event would be an uncaught
    // exception that takes the process down.
    let upstreamSocketClosed = false;
    upstream = http.createServer((_req, res) => {
      // Slow rejection: the client is long gone by the time this lands.
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(429, { "content-length": "2" });
          res.end("{}");
        }
      }, 300);
    });
    upstream.on("connection", (s) => s.on("close", () => (upstreamSocketClosed = true)));
    const upstreamPort = await listen(upstream);

    proxy = http.createServer();
    attachGraphqlWsProxy(proxy, {
      backendUrl: `http://127.0.0.1:${upstreamPort}`,
      trustProxy: false,
    });
    const proxyPort = await listen(proxy);

    const client = net.connect(proxyPort, "127.0.0.1");
    client.on("error", () => {}); // expected ECONNRESET on our own side
    client.write(
      `GET /graphql HTTP/1.1\r\nhost: x\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`
    );
    client.resetAndDestroy(); // RST mid-handshake (the exact unhandled-ECONNRESET path)

    // Give the late upstream response time to arrive at a dead socket.
    await new Promise((r) => setTimeout(r, 500));
    // No uncaught exception (jest would have failed the suite), and the
    // bridge cancelled the upstream request instead of leaking it.
    expect(upstreamSocketClosed).toBe(true);
  });

  it("survives a client reset while a rejection response is in flight", async () => {
    let upstreamSocketClosed = false;
    upstream = http.createServer((_req, res) => {
      // Respond after the client has already reset: the relay must notice
      // the dead socket and skip the write rather than throw on it.
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(429, { "content-type": "application/json" });
          res.write('{"errors":[');
          res.write('{"message":"too many requests"}');
          res.end("]}");
        }
      }, 150);
    });
    upstream.on("connection", (s) => s.on("close", () => (upstreamSocketClosed = true)));
    const upstreamPort = await listen(upstream);

    proxy = http.createServer();
    attachGraphqlWsProxy(proxy, {
      backendUrl: `http://127.0.0.1:${upstreamPort}`,
      trustProxy: false,
    });
    const proxyPort = await listen(proxy);

    const client = net.connect(proxyPort, "127.0.0.1");
    client.on("error", () => {});
    client.write(
      `GET /graphql HTTP/1.1\r\nhost: x\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`
    );
    await new Promise((r) => setTimeout(r, 50)); // request accepted, response pending
    client.resetAndDestroy(); // RST while the rejection is in flight

    await new Promise((r) => setTimeout(r, 400));
    expect(upstreamSocketClosed).toBe(true);
  });

  describe("wsClientIp", () => {
    it("never returns undefined (undefined header values crash http.request)", () => {
      const req = { socket: { remoteAddress: "10.1.1.1" }, headers: {} };
      expect(wsClientIp(req, false)).toBe("10.1.1.1");
      expect(wsClientIp(req, true)).toBe("10.1.1.1"); // trust on, no XFF → peer
      expect(wsClientIp({ socket: undefined, headers: {} }, true)).toBe("127.0.0.1");
    });

    it("takes the rightmost XFF entry only when trusted", () => {
      const req = {
        socket: { remoteAddress: "10.1.1.1" },
        headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9" },
      };
      expect(wsClientIp(req, true)).toBe("9.9.9.9");
      expect(wsClientIp(req, false)).toBe("10.1.1.1"); // untrusted: ignore XFF
    });
  });
});
