// Regression tests for the Node→Go event bridge (utils/graphEvents.js).
// Guards the two failure callbacks that once crashed the server with
// "Cannot read properties of undefined (reading 'debug')" when the Go
// backend answered /internal/events with 401. The callbacks now log at
// warn level so rejections are visible at the production log level.
const http = require("http");

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// graphEvents captures GRAPHQL_BACKEND at module load, so each test loads a
// fresh copy with the env var pointed at its own stub server.
function loadBridge(backendUrl) {
  process.env.GRAPHQL_BACKEND = backendUrl;
  jest.resetModules();
  jest.doMock("../../utils/logger", () => mockLogger);
  return require("../../utils/graphEvents");
}

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port))
  );
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("condition not met in time"));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe("publishGraphEvent failure callbacks", () => {
  let prevBackend;

  beforeAll(() => {
    prevBackend = process.env.GRAPHQL_BACKEND;
  });

  afterAll(() => {
    if (prevBackend === undefined) delete process.env.GRAPHQL_BACKEND;
    else process.env.GRAPHQL_BACKEND = prevBackend;
  });

  beforeEach(() => mockLogger.warn.mockClear());

  test("rejected response (401) logs warn and does not throw", async () => {
    let gotPath = null;
    const server = http.createServer((req, res) => {
      gotPath = req.url;
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    const port = await listen(server);
    const { publishGraphEvent } = loadBridge(`http://127.0.0.1:${port}`);

    try {
      expect(() => publishGraphEvent("containersUpdated", 1, { count: 1 })).not.toThrow();
      await waitFor(() => mockLogger.warn.mock.calls.length > 0);
      const [msg, meta] = mockLogger.warn.mock.calls[0];
      expect(msg).toBe("Graph event bridge rejected");
      expect(meta).toMatchObject({ module: "graphEvents", type: "containersUpdated", status: 401 });
      expect(gotPath).toBe("/internal/events");
    } finally {
      await close(server);
    }
  });

  test("connection error logs warn and does not throw", async () => {
    // Bind then immediately close a port so the connect attempt fails (ECONNREFUSED).
    const probe = http.createServer();
    const port = await listen(probe);
    await close(probe);
    const { publishGraphEvent } = loadBridge(`http://127.0.0.1:${port}`);

    expect(() => publishGraphEvent("upgradeProgress", 1, { step: "x" })).not.toThrow();
    await waitFor(() => mockLogger.warn.mock.calls.length > 0);
    const [msg, meta] = mockLogger.warn.mock.calls[0];
    expect(msg).toBe("Graph event bridge error");
    expect(meta).toMatchObject({ module: "graphEvents", type: "upgradeProgress" });
  });

  test("unknown event types are dropped without any HTTP call", () => {
    const { publishGraphEvent } = loadBridge("http://127.0.0.1:1"); // would fail fast if called
    expect(() => publishGraphEvent("notAnEventType", 1, {})).not.toThrow();
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });
});
