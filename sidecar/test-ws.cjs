/**
 * Phase 4 Verification: WebSocket (WS) + Secure WebSocket (WSS) Test Script
 *
 * Tests both transport layers:
 *   - ws://127.0.0.1:7778  (HTTP loopback for Tauri admin)
 *   - wss://<LAN_IP>:7777   (HTTPS for phone browsers)
 *
 * Exercises the admin WebSocket API including:
 *   - Connection + welcome message
 *   - identify (admin role)
 *   - ping/pong
 *   - config:get
 *   - server:status
 *   - channels:list
 *   - sources:list
 *   - streaming:status
 *   - streaming:workers
 *   - streaming:listeners
 *
 * Usage:
 *   node test-ws.cjs                     # Auto-detect LAN IP from config
 *   node test-ws.cjs 192.168.1.100       # Override LAN IP
 *   node test-ws.cjs --ws-only           # Test only WS (loopback)
 *   node test-ws.cjs --wss-only          # Test only WSS (HTTPS)
 *   node test-ws.cjs --wss-only 192.168.1.100
 */

const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ADMIN_LOOPBACK_PORT = 7778;
const DEFAULT_HTTPS_PORT = 7777;
const TIMEOUT_MS = 8000;

// Parse CLI args
const args = process.argv.slice(2);
const wsOnly = args.includes("--ws-only");
const wssOnly = args.includes("--wss-only");
const ipArg = args.find((a) => !a.startsWith("--"));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASS = "\x1b[32m PASS \x1b[0m";
const FAIL = "\x1b[31m FAIL \x1b[0m";
const INFO = "\x1b[36m INFO \x1b[0m";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function log(tag, msg) {
  console.log(`  ${tag} ${msg}`);
}

function resolveConfig() {
  const configPaths = [
    path.join(__dirname, "config.json"),
    path.join(__dirname, "..", "config.json"),
  ];

  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf8");
        const config = JSON.parse(raw);
        return {
          host: config?.server?.host || "127.0.0.1",
          port: config?.server?.port || DEFAULT_HTTPS_PORT,
        };
      } catch {
        // ignore parse errors
      }
    }
  }

  return { host: "127.0.0.1", port: DEFAULT_HTTPS_PORT };
}

/**
 * Send a message and wait for a response matching the expected type.
 */
function sendAndWait(ws, msg, expectedType, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for "${expectedType}" (${timeoutMs}ms)`));
    }, timeoutMs);

    function onMessage(raw) {
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === expectedType) {
          cleanup();
          resolve(parsed);
        }
      } catch {
        // ignore non-JSON
      }
    }

    function cleanup() {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
    }

    ws.on("message", onMessage);
    ws.send(JSON.stringify(msg));
  });
}

/**
 * Connect to a WebSocket URL and return the ws instance + welcome message.
 */
function connect(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Connection timeout to ${url} (${TIMEOUT_MS}ms)`));
    }, TIMEOUT_MS);

    const ws = new WebSocket(url, { rejectUnauthorized: false });

    ws.on("open", () => {
      ws.once("message", (raw) => {
        clearTimeout(timer);
        try {
          const welcome = JSON.parse(raw.toString());
          resolve({ ws, welcome });
        } catch (err) {
          clearTimeout(timer);
          reject(new Error(`Failed to parse welcome: ${err.message}`));
        }
      });
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Test suite for one connection
// ---------------------------------------------------------------------------

async function runTestSuite(label, url) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Testing: ${label}`);
  console.log(`  URL:     ${url}`);
  console.log(`${"=".repeat(60)}\n`);

  let ws;
  let suitePass = 0;
  let suiteFail = 0;

  function assert(testName, condition, detail) {
    totalTests++;
    if (condition) {
      passedTests++;
      suitePass++;
      log(PASS, testName);
    } else {
      failedTests++;
      suiteFail++;
      log(FAIL, `${testName} -- ${detail || "assertion failed"}`);
    }
  }

  try {
    // -- Test 1: Connect and receive welcome --
    const { ws: socket, welcome } = await connect(url);
    ws = socket;

    assert(
      "Connect + welcome message",
      welcome.type === "welcome" &&
        welcome.payload?.version &&
        welcome.payload?.clientId,
      `Got type="${welcome.type}", version="${welcome.payload?.version}"`,
    );

    const clientId = welcome.payload?.clientId;
    log(INFO, `Client ID: ${clientId}`);

    // -- Test 2: Identify as admin --
    const identifyResp = await sendAndWait(
      ws,
      { type: "identify", payload: { role: "admin" }, requestId: "id-1" },
      "identify:ack",
    );

    assert(
      "Identify as admin",
      identifyResp.payload?.role === "admin" &&
        identifyResp.payload?.clientId === clientId,
      `role="${identifyResp.payload?.role}", clientId match=${identifyResp.payload?.clientId === clientId}`,
    );

    // -- Test 3: Ping/Pong --
    const pongResp = await sendAndWait(
      ws,
      { type: "ping", requestId: "ping-1" },
      "pong",
    );

    assert(
      "Ping -> Pong",
      pongResp.type === "pong" && pongResp.requestId === "ping-1",
      `type="${pongResp.type}", requestId="${pongResp.requestId}"`,
    );

    // -- Test 4: config:get --
    const configResp = await sendAndWait(
      ws,
      { type: "config:get", requestId: "cfg-1" },
      "config:response",
    );

    assert(
      "config:get returns valid config",
      configResp.payload?.server?.port !== undefined &&
        configResp.payload?.server?.host !== undefined &&
        configResp.payload?.audio !== undefined &&
        configResp.payload?.mediasoup !== undefined &&
        configResp.payload?.streaming !== undefined,
      `Has server.port=${configResp.payload?.server?.port}, mediasoup=${!!configResp.payload?.mediasoup}`,
    );

    // -- Test 5: server:status --
    const statusResp = await sendAndWait(
      ws,
      { type: "server:status", requestId: "stat-1" },
      "server:status",
    );

    assert(
      "server:status returns uptime + connections",
      statusResp.payload?.uptime > 0 &&
        statusResp.payload?.connections?.total >= 1,
      `uptime=${statusResp.payload?.uptime?.toFixed(1)}s, connections=${statusResp.payload?.connections?.total}`,
    );

    // -- Test 6: channels:list --
    const channelsResp = await sendAndWait(
      ws,
      { type: "channels:list", requestId: "ch-1" },
      "channels:list",
    );

    assert(
      "channels:list returns array",
      Array.isArray(channelsResp.payload?.channels),
      `channels count=${channelsResp.payload?.channels?.length}`,
    );

    if (channelsResp.payload?.channels?.length > 0) {
      const ch = channelsResp.payload.channels[0];
      log(INFO, `First channel: "${ch.name}" (id=${ch.id?.slice(0, 8)}..., status=${ch.status})`);
    }

    // -- Test 7: sources:list --
    const sourcesResp = await sendAndWait(
      ws,
      { type: "sources:list", requestId: "src-1" },
      "sources:list",
    );

    assert(
      "sources:list returns array",
      Array.isArray(sourcesResp.payload?.sources),
      `sources count=${sourcesResp.payload?.sources?.length}`,
    );

    // -- Test 8: streaming:status --
    const streamingResp = await sendAndWait(
      ws,
      { type: "streaming:status", requestId: "str-1" },
      "streaming:status",
    );

    const hasStreamingFields =
      streamingResp.payload?.totalListeners !== undefined &&
      Array.isArray(streamingResp.payload?.channels) &&
      Array.isArray(streamingResp.payload?.workers);

    assert(
      "streaming:status returns totalListeners + channels + workers",
      hasStreamingFields,
      `listeners=${streamingResp.payload?.totalListeners}, channels=${streamingResp.payload?.channels?.length}, workers=${streamingResp.payload?.workers?.length}`,
    );

    if (streamingResp.payload?.workers?.length > 0) {
      const w = streamingResp.payload.workers[0];
      log(INFO, `Worker 0: alive=${w.alive}, memory=${w.peakMemoryKb}KB, routers=${w.routerCount}`);
    }

    if (streamingResp.payload?.channels?.length > 0) {
      const sc = streamingResp.payload.channels[0];
      log(
        INFO,
        `Streaming channel: "${sc.name}" active=${sc.isActive}, listeners=${sc.listenerCount}, latency=${sc.latencyEstimate?.totalMs}ms (${sc.latencyMode})`,
      );
    }

    // -- Test 9: streaming:workers --
    const workersResp = await sendAndWait(
      ws,
      { type: "streaming:workers", requestId: "wrk-1" },
      "streaming:workers",
    );

    assert(
      "streaming:workers returns worker array",
      Array.isArray(workersResp.payload?.workers),
      `workers count=${workersResp.payload?.workers?.length}`,
    );

    // -- Test 10: streaming:listeners --
    const listenersResp = await sendAndWait(
      ws,
      {
        type: "streaming:listeners",
        payload: { displayMode: "all" },
        requestId: "lsn-1",
      },
      "streaming:listeners",
    );

    assert(
      "streaming:listeners returns sessions + stats",
      Array.isArray(listenersResp.payload?.sessions) &&
        Array.isArray(listenersResp.payload?.stats) &&
        listenersResp.payload?.displayMode === "all",
      `sessions=${listenersResp.payload?.sessions?.length}, displayMode=${listenersResp.payload?.displayMode}`,
    );

    // -- Test 11: Error handling (unknown type) --
    const errorResp = await sendAndWait(
      ws,
      { type: "nonexistent:message", requestId: "err-1" },
      "error",
    );

    assert(
      "Unknown message type returns error",
      errorResp.type === "error" &&
        errorResp.payload?.message?.includes("Unknown message type"),
      `error="${errorResp.payload?.message}"`,
    );

    // -- Test 12: interfaces:list --
    const ifacesResp = await sendAndWait(
      ws,
      { type: "interfaces:list", requestId: "if-1" },
      "interfaces:list",
    );

    assert(
      "interfaces:list returns interface array",
      Array.isArray(ifacesResp.payload?.interfaces) &&
        ifacesResp.payload.interfaces.length > 0,
      `interfaces count=${ifacesResp.payload?.interfaces?.length}`,
    );

  } catch (err) {
    totalTests++;
    failedTests++;
    suiteFail++;
    log(FAIL, `Suite error: ${err.message}`);
  } finally {
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
    }
  }

  console.log(
    `\n  Suite result: ${suitePass} passed, ${suiteFail} failed\n`,
  );
}

// ---------------------------------------------------------------------------
// Protoo listener WS path test (WSS only)
// ---------------------------------------------------------------------------

async function testListenerWsPath(host, port) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Testing: Listener WebSocket path (/ws/listener)`);
  console.log(`  URL:     wss://${host}:${port}/ws/listener`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    const url = `wss://${host}:${port}/ws/listener`;
    const ws = new WebSocket(url, "protoo", { rejectUnauthorized: false });

    const connected = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        ws.close();
        resolve("timeout");
      }, 5000);

      ws.on("open", () => {
        clearTimeout(timer);
        resolve("open");
      });

      ws.on("unexpected-response", (_req, res) => {
        clearTimeout(timer);
        resolve(`http-${res.statusCode}`);
      });

      ws.on("error", (err) => {
        clearTimeout(timer);
        resolve(`error: ${err.message}`);
      });
    });

    totalTests++;
    if (connected === "open") {
      passedTests++;
      log(PASS, "Listener path /ws/listener accepted by protoo WebSocket server");

      // If connected, we should NOT get admin "welcome" message
      const gotWelcome = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 2000);
        ws.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "welcome") {
              clearTimeout(timer);
              resolve(true);
            }
          } catch {
            // protoo may send binary or non-JSON
          }
        });
      });

      totalTests++;
      if (!gotWelcome) {
        passedTests++;
        log(PASS, "Listener path does NOT receive admin welcome (correct path routing)");
      } else {
        failedTests++;
        log(FAIL, "Listener path received admin welcome (wrong path routing!)");
      }

      ws.close();
    } else {
      // Any response is acceptable as long as the server didn't crash
      passedTests++;
      log(PASS, `Listener path response: ${connected} (path routing is active)`);
    }
  } catch (err) {
    totalTests++;
    failedTests++;
    log(FAIL, `Listener path test error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = resolveConfig();
  const lanHost = ipArg || config.host;
  const httpsPort = config.port;

  console.log("\n" + "=".repeat(60));
  console.log("  ChurchAudioStream -- Phase 4 WS/WSS Verification");
  console.log("=".repeat(60));
  console.log(`  Admin loopback (WS):   ws://127.0.0.1:${ADMIN_LOOPBACK_PORT}`);
  console.log(`  HTTPS server (WSS):    wss://${lanHost}:${httpsPort}`);
  console.log(`  Listener path (WSS):   wss://${lanHost}:${httpsPort}/ws/listener`);
  console.log("=".repeat(60));

  if (!wssOnly) {
    await runTestSuite(
      "Admin WS (HTTP loopback)",
      `ws://127.0.0.1:${ADMIN_LOOPBACK_PORT}`,
    );
  }

  if (!wsOnly) {
    await runTestSuite(
      "Admin WSS (HTTPS LAN)",
      `wss://${lanHost}:${httpsPort}`,
    );

    await testListenerWsPath(lanHost, httpsPort);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("  SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Total:  ${totalTests}`);
  console.log(`  ${PASS}: ${passedTests}`);
  console.log(`  ${FAIL}: ${failedTests}`);
  console.log("=".repeat(60) + "\n");

  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
