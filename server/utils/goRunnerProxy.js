/**
 * Transparent streaming proxy for the runner REST routes that now live in the
 * Go backend (internal/api/handlers). Same bridge pattern as the /graphql
 * proxy in server.js: Node keeps the edge rate limiters (and, for the
 * user-facing routes, the authenticate middleware) and forwards everything
 * else untouched, so the URL contract for dockhand agents and the browser
 * does not change.
 *
 * Headers:
 *  - Authorization is forwarded verbatim (Go re-validates with the shared
 *    JWT secret; the revocation + user-existence checks run on both sides).
 *  - X-Forwarded-For is OVERWRITTEN with the validated client IP — a
 *    client-supplied prefix is spoofable and would mint fresh buckets in
 *    Go's per-IP rate limiter.
 *  - X-Forwarded-Proto/Host are set from what express resolved (trust proxy),
 *    because Go's install/enrollment URL builder reads them.
 */

const http = require("http");

// Resolved per request so tests (and unusual deployments) can point it at a
// different stub without reloading the module.
const goBackend = () => process.env.GRAPHQL_BACKEND || "http://127.0.0.1:4000";

function createGoRunnerProxy({ preflight, onUpstream2xx } = {}) {
  return async function goRunnerProxy(req, res) {
    // Optional bridge hooks for state that still lives in Node (e.g. the
    // version poller's backoff). preflight runs before the request is
    // forwarded so it can observe pre-mutation DB state.
    let bridgeData;
    if (preflight) {
      try {
        bridgeData = await preflight(req);
      } catch {
        bridgeData = undefined;
      }
    }

    const targetUrl = `${goBackend()}${req.originalUrl}`;

    const headers = {
      ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      "X-Forwarded-For": req.ip,
      "X-Forwarded-Proto": req.protocol,
      "X-Forwarded-Host": req.get("host"),
    };

    const isGet = req.method === "GET";
    let body = null;
    if (!isGet) {
      // express.json already consumed the stream; re-serialize the parsed body.
      body = JSON.stringify(req.body || {});
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const proxyReq = http.request(targetUrl, { method: req.method, headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res); // streams install scripts (and later SSE) untouched
      if (onUpstream2xx && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
        try {
          onUpstream2xx(req, proxyRes, bridgeData);
        } catch {
          /* bridge bookkeeping must never break the proxied response */
        }
      }
    });

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          error: "Go backend unavailable",
          detail: err.message,
        });
      } else {
        res.end();
      }
    });

    if (isGet) proxyReq.end();
    else proxyReq.end(body);
  };
}

module.exports = { createGoRunnerProxy };
