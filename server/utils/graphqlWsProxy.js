const http = require("http");

// Proxy WebSocket upgrades for /graphql to the Go backend so graphql-ws
// subscriptions reach the Go transport through the same path as HTTP.
//
// IMPORTANT: the "upgrade" event fires on the raw http.Server and bypasses
// Express entirely — req.ip and other Express properties DO NOT exist here.
// Client identity must be derived from the socket peer plus (when the
// trust-proxy policy is on) the incoming X-Forwarded-For, mirroring express'
// own algorithm. Getting this wrong throws inside the event handler, and an
// uncaught exception in the upgrade path takes the whole process down.
function attachGraphqlWsProxy(server, { backendUrl, trustProxy, logger }) {
  server.on("upgrade", (req, socket, head) => {
    try {
      const url = req.url || "";
      if (!url.startsWith("/graphql")) {
        socket.destroy();
        return;
      }
      const target = new URL(backendUrl);
      const targetPort = target.port || 80;
      const proxyReq = http.request({
        host: target.hostname,
        port: targetPort,
        method: "GET",
        path: url,
        headers: {
          ...req.headers,
          host: `${target.hostname}:${targetPort}`,
          // Overwrite, never append: the Go limiter keys on the rightmost
          // XFF entry, so this must be the validated client IP only.
          "x-forwarded-for": wsClientIp(req, trustProxy),
        },
      });

      // Install client-socket error handling IMMEDIATELY, before the
      // upstream handshake completes: a client that resets (or FINs) while
      // the handshake or a rejection response is in flight emits "error" on
      // this socket, and an unhandled "error" event is an uncaught exception
      // that takes the whole process down. Destroying proxyReq tears the
      // upstream side down with it.
      const onClientGone = () => {
        proxyReq.destroy();
        socket.destroy();
      };
      socket.on("error", onClientGone);
      socket.on("end", onClientGone);

      proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
        const headerLines = [];
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          headerLines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
        }
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines.join("\r\n")}\r\n\r\n`);
        if (proxyHead && proxyHead.length) socket.write(proxyHead);
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
        const destroy = () => {
          proxySocket.destroy();
          socket.destroy();
        };
        proxySocket.on("error", destroy);
        socket.on("error", destroy);
        proxySocket.on("close", destroy);
        socket.on("close", destroy);
        // FIN from one peer only ends that direction: the socket's writable
        // side stays open, so "close" never fires and both sockets (plus the
        // server's connection accounting) leak forever. Treat "end" as the
        // peer going away and tear the whole bridge down.
        proxySocket.on("end", destroy);
        socket.on("end", destroy);
      });

      proxyReq.on("response", (proxyRes) => {
        // Upstream refused the upgrade with a plain HTTP response (e.g. the
        // Go limiter's 429). Relay it COMPLETELY — headers and body — so the
        // framing stays valid and the browser's WebSocket fails fast instead
        // of hanging on a half-open socket. The body is buffered (already
        // de-chunked by the http client), so hop-by-hop framing headers are
        // dropped and a correct Content-Length is written.
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          if (socket.destroyed || !socket.writable) return; // client left mid-relay
          const body = Buffer.concat(chunks);
          const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ""}`];
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (["connection", "transfer-encoding", "content-length"].includes(k)) continue;
            lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
          }
          lines.push(`content-length: ${body.length}`);
          socket.write(`${lines.join("\r\n")}\r\n\r\n`);
          socket.end(body);
        });
        proxyRes.on("error", () => socket.destroy());
      });

      proxyReq.on("error", (err) => {
        if (logger) {
          logger.warn("GraphQL WS proxy error", { module: "server", error: err.message });
        }
        socket.destroy();
      });

      proxyReq.end();
    } catch (err) {
      // A synchronous failure here (bad URL, header construction) must never
      // escape as an uncaught exception from the upgrade event.
      if (logger) {
        logger.warn("GraphQL WS proxy setup failed", { module: "server", error: err.message });
      }
      socket.destroy();
    }
  });
}

// Derive the client IP for a raw upgrade request: with trust-proxy enabled,
// the rightmost incoming X-Forwarded-For entry (the address the trusted
// front proxy appended); otherwise the socket peer. Never returns undefined,
// which would make http.request throw on the header value.
function wsClientIp(req, trustProxy) {
  const peer = req.socket && req.socket.remoteAddress;
  if (trustProxy) {
    const xff = req.headers && req.headers["x-forwarded-for"];
    if (xff) {
      const parts = String(xff).split(",");
      const last = parts[parts.length - 1].trim();
      if (last) return last;
    }
  }
  return peer || "127.0.0.1";
}

module.exports = { attachGraphqlWsProxy, wsClientIp };
