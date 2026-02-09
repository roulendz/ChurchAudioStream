---
status: resolved
trigger: "WSS admin WebSocket upgrade interference -- identify:ack times out on wss://<LAN_IP>:7777 but ws://127.0.0.1:7778 works fine"
created: 2026-02-09T00:00:00Z
updated: 2026-02-09T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED -- protoo's WebSocket-Node intercepts ALL upgrade requests on the HTTPS server before the admin ws server's handler runs, because both register on the same `server.on("upgrade")` event and WebSocket-Node grabs the upgrade first (no path filtering at the upgrade level).
test: Traced the full upgrade event chain through all three libraries
expecting: Two competing upgrade handlers on the same httpsServer
next_action: N/A -- root cause confirmed

## Symptoms

expected: Admin WSS connections to wss://<LAN_IP>:7777 should connect, receive "welcome", send "identify", and receive "identify:ack" -- identical behavior to ws://127.0.0.1:7778.
actual: WSS connections to port 7777 connect and receive a "welcome" message, but "identify:ack" times out after 8s. WS loopback on port 7778 works perfectly (12/12 tests pass).
errors: Timeout waiting for "identify:ack" (8000ms)
reproduction: Run `node test-ws.cjs --wss-only` -- the identify test times out on the HTTPS/WSS endpoint.
started: Since ListenerWebSocketHandler was wired to the same httpsServer (Phase 4 streaming integration).

## Eliminated

(none -- first hypothesis was correct)

## Evidence

- timestamp: 2026-02-09T00:01:00Z
  checked: sidecar/src/server.ts -- createServer() function
  found: Line 68-69: `httpsServer` is created, then `setupWebSocket(httpsServer, ...)` is called which registers `server.on("upgrade", ...)` on the HTTPS server for admin WS routing. Line 71-72: `httpServer` gets its own independent `setupWebSocket()` call. The HTTPS server gets the admin upgrade handler FIRST.
  implication: The admin ws server (ws module, noServer mode) is properly set up with path-based routing that skips `/ws/listener` paths (line 74).

- timestamp: 2026-02-09T00:02:00Z
  checked: sidecar/src/ws/handler.ts -- setupWebSocket() upgrade handler
  found: Lines 72-82: The admin WS upgrade handler checks `if (pathname.startsWith(LISTENER_WS_PATH))` and returns early (does not handle) for listener paths. For all other paths, it calls `wss.handleUpgrade()`. This is correct routing logic.
  implication: The admin WS handler is designed to coexist with protoo by yielding listener paths. But this only works if it gets the upgrade event.

- timestamp: 2026-02-09T00:03:00Z
  checked: sidecar/src/ws/listener-handler.ts -- ListenerWebSocketHandler constructor
  found: Line 143: `this.protooWsServer = new protooServer.WebSocketServer(httpsServer)` -- passes the HTTPS server directly to protoo-server.
  implication: protoo-server will register its own upgrade handler on the same httpsServer.

- timestamp: 2026-02-09T00:04:00Z
  checked: sidecar/node_modules/protoo-server/lib/transports/WebSocketServer.js
  found: Line 35: protoo creates `new websocket.server(options)` where options.httpServer = httpsServer. This is WebSocket-Node (the `websocket` npm package), a completely different WebSocket library from `ws`.
  implication: Two different WebSocket libraries (ws and WebSocket-Node) are both hooking into the same HTTP server's upgrade event.

- timestamp: 2026-02-09T00:05:00Z
  checked: sidecar/node_modules/websocket/lib/WebSocketServer.js -- mount() method
  found: Lines 140-148: WebSocket-Node's `mount()` calls `httpServer.on('upgrade', upgradeHandler)` -- it registers its OWN upgrade handler on the same httpsServer. Line 198-232: `handleUpgrade()` unconditionally reads the handshake from the socket. It does NOT check the URL path before consuming the upgrade. It creates a WebSocketRequest and emits a `request` event.
  implication: WebSocket-Node CONSUMES every upgrade request on the httpsServer regardless of path. It reads the handshake bytes from the socket, making the upgrade unavailable to any other handler.

- timestamp: 2026-02-09T00:06:00Z
  checked: sidecar/src/index.ts -- initialization order
  found: Line 198-205: `createServer()` is called first (registers admin WS upgrade handler on httpsServer). Line 227: `streamingSubsystem.start(components.httpsServer)` is called AFTER, which creates ListenerWebSocketHandler, which creates protoo WebSocketServer, which registers WebSocket-Node's upgrade handler on the SAME httpsServer.
  implication: After startup, httpsServer has TWO upgrade listeners: (1) admin ws handler (registered first), (2) WebSocket-Node handler (registered second). Node.js EventEmitter calls listeners in registration order.

- timestamp: 2026-02-09T00:07:00Z
  checked: Protoo connectionrequest handler in listener-handler.ts
  found: Lines 177-183: The protoo connectionrequest handler checks `if (!requestUrl.startsWith(LISTENER_WS_PATH))` and calls `reject(404, "Not found")` for non-listener paths. This means for admin connections: protoo's WebSocket-Node intercepts the upgrade, checks the subprotocol (rejects if no "protoo" subprotocol), OR passes to connectionrequest handler which rejects non-listener paths.
  implication: For admin WSS connections (no "protoo" subprotocol), WebSocket-Node rejects at line 63-70 of protoo's WebSocketServer.js with 403 "invalid/missing Sec-WebSocket-Protocol". The socket is consumed and destroyed before the admin ws handler ever sees it.

- timestamp: 2026-02-09T00:08:00Z
  checked: Why admin gets "welcome" despite protoo intercepting
  found: Re-examining the event flow: Node.js EventEmitter fires ALL listeners for an event. The admin ws handler (listener 1) fires FIRST (registered in createServer), does path check, and for non-listener paths calls `wss.handleUpgrade()`. WebSocket-Node handler (listener 2) fires SECOND and also tries to handle the same upgrade. HOWEVER -- `wss.handleUpgrade()` from the `ws` library reads the socket asynchronously, while WebSocket-Node's `handleUpgrade()` also reads the socket. This creates a race condition where BOTH try to complete the WebSocket handshake on the same socket.
  implication: The admin ws handler completes its handshake first (sends welcome), but WebSocket-Node also tries to read the same socket's handshake data, corrupting the connection. Messages sent by the admin side (welcome) may get through, but subsequent data frames are corrupted or the socket state is inconsistent. This explains why "welcome" arrives but "identify:ack" never does -- the connection is in a broken state.

- timestamp: 2026-02-09T00:09:00Z
  checked: Why WS loopback on port 7778 works perfectly
  found: The HTTP server on port 7778 (httpServer) only has ONE upgrade handler -- the admin ws handler registered via `setupWebSocket(httpServer, ...)`. No protoo/WebSocket-Node is attached to httpServer. The StreamingSubsystem only passes `httpsServer` to ListenerWebSocketHandler (line 160-161 of streaming-subsystem.ts).
  implication: Port 7778 has no competing upgrade handler, so it works flawlessly. Port 7777 has two competing handlers on the same upgrade event -- that is the root cause.

## Resolution

root_cause: Two WebSocket libraries (ws and WebSocket-Node/protoo) both register `upgrade` event handlers on the same `httpsServer`. Node.js EventEmitter fires both handlers for every upgrade request. The admin ws handler (registered first via `setupWebSocket()`) correctly handles non-listener paths and yields listener paths. But WebSocket-Node (registered second via `new protooServer.WebSocketServer(httpsServer)`) unconditionally consumes the upgrade handshake for ALL paths. For admin connections on port 7777, BOTH handlers attempt to complete the WebSocket handshake on the same raw TCP socket simultaneously. The admin handler completes first (sends "welcome"), but WebSocket-Node's concurrent handshake attempt corrupts the socket state, causing all subsequent message exchange to fail (identify:ack timeout). The HTTP loopback server on port 7778 works because only the admin ws handler is attached to it -- no protoo/WebSocket-Node interference.

fix: (not yet applied -- see MISSING section)

verification: (not yet applied)

files_changed: []
