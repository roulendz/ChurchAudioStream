# Phase 1: Project Foundation & Configuration - Research

**Researched:** 2026-02-05
**Domain:** Tauri 2.x desktop app with Node.js sidecar, Express web server, WebSocket signaling, JSON config persistence
**Confidence:** HIGH

## Summary

Phase 1 establishes the application skeleton: a Tauri 2.x desktop shell that launches a Node.js sidecar process running Express and WebSocket servers, with persistent JSON configuration. The research covers six key domains: (1) Tauri 2.x project scaffolding and sidecar configuration, (2) Node.js binary compilation for sidecar distribution, (3) Express 5.x + ws WebSocket on a shared HTTPS server, (4) self-signed certificate generation, (5) mDNS service discovery, and (6) JSON configuration with schema validation.

The critical architectural insight is that the Tauri GUI should communicate with the Node.js sidecar via the same WebSocket/HTTP connection that browser clients use -- this aligns with the "admin GUI is just another client" decision and simplifies the architecture. The sidecar is compiled to a standalone binary using `@yao-pkg/pkg` for Phase 1 (Express + ws only), but the project structure must accommodate future mediasoup integration where the native C++ worker binary needs to be shipped alongside the sidecar (via `MEDIASOUP_WORKER_BIN` environment variable).

**Primary recommendation:** Scaffold with `create-tauri-app` (React + TypeScript), compile sidecar with `@yao-pkg/pkg`, run Express 5.x + ws on a shared HTTPS server using `selfsigned` certificates, validate config with Zod, and use `bonjour-service` for mDNS -- all on port 7777 with the admin GUI connecting as a regular WebSocket client.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tauri | 2.10.x | Desktop shell, window management, sidecar lifecycle | Latest stable (2.10.2 released 2026-02-04). Lightweight vs Electron. Locked decision |
| @tauri-apps/plugin-shell | 2.3.x | Spawn/manage Node.js sidecar process | Official Tauri plugin for sidecar management with stdout/stderr events |
| Express | 5.x | HTTP server, REST API, static file serving | Express 5 stable since Oct 2024. Latest 5.2.1. Default on npm since Mar 2025 |
| ws | 8.19.x | WebSocket server | De facto Node.js WebSocket library. 17.7M+ users. Blazing fast, protocol-compliant |
| Zod | 4.x | Config schema validation + TypeScript type inference | TypeScript-first. Eliminates duplicate type declarations. Latest 4.3.5 |
| React | 19.x | Admin UI + Listener PWA frontend | Locked decision from roadmap |
| TypeScript | 5.5+ | Type safety for both frontend and sidecar | Required by Zod 4.x. Best practice for project of this scale |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @yao-pkg/pkg | 6.12.x | Compile Node.js sidecar to standalone binary | Build step: compile sidecar so end users don't need Node.js installed |
| selfsigned | 5.x | Generate self-signed TLS certificates | First-run: generate cert/key pair for HTTPS server. Async-only in v5 |
| bonjour-service | 1.3.x | mDNS/Bonjour service advertisement | Publish `_http._tcp` service on local network for device discovery. Pure JS, no native deps |
| hostile | 1.x | Programmatic hosts file editing | Write configured domain name to system hosts file. Requires admin/root privileges |
| Vite | 6.x | Frontend build tool, dev server, HMR | Scaffolded by create-tauri-app. Fast dev experience |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @yao-pkg/pkg | Node.js SEA (v25.5+ --build-sea) | SEA is newer/simpler but pkg is more mature. SEA has issues with native modules. pkg has proven track record with Express apps. For Phase 1 (no native modules), either works -- but pkg is better documented for Tauri sidecars |
| @yao-pkg/pkg | Bundle raw node.exe + JS files | Larger distribution size, JS source visible to users, but zero compilation issues. Consider as fallback if pkg causes problems with mediasoup in later phases |
| ws | Socket.IO | Socket.IO adds overhead (polling fallback, rooms, namespaces) not needed. ws is lower-level and lighter -- ideal since we control both client and server |
| Zod | Ajv | Ajv is faster for pure JSON Schema validation but requires separate TypeScript types. Zod generates types from schemas -- single source of truth |
| selfsigned | mkcert / node-forge directly | selfsigned wraps node-forge with simpler API. mkcert adds CA trust but is overkill for self-signed local use |
| bonjour-service | mdns (native) | mdns requires native compilation (libavahi on Linux, Bonjour SDK on Windows). bonjour-service is pure JS -- no native deps, works everywhere |

**Installation (sidecar project):**
```bash
npm install express ws zod selfsigned bonjour-service hostile
npm install --save-dev @yao-pkg/pkg typescript @types/express @types/ws
```

**Installation (Tauri frontend):**
```bash
npm install @tauri-apps/plugin-shell
```

## Architecture Patterns

### Recommended Project Structure
```
ChurchAudioStream/
├── src/                          # React frontend (Tauri webview content)
│   ├── components/               # React components
│   ├── hooks/                    # Custom hooks (useWebSocket, useConfig, etc.)
│   ├── pages/                    # Admin and Listener page roots
│   └── App.tsx                   # Main app component
├── src-tauri/                    # Tauri Rust shell
│   ├── src/
│   │   └── lib.rs                # Tauri setup, sidecar lifecycle, plugin registration
│   ├── binaries/                 # Compiled sidecar binary (gitignored, built by script)
│   ├── capabilities/
│   │   └── default.json          # Shell plugin permissions
│   ├── Cargo.toml
│   └── tauri.conf.json           # Tauri configuration
├── sidecar/                      # Node.js sidecar source
│   ├── src/
│   │   ├── index.ts              # Entry point: bootstrap server
│   │   ├── server.ts             # Express + HTTPS + WebSocket setup
│   │   ├── config/
│   │   │   ├── schema.ts         # Zod schema (single source of truth for config shape + types)
│   │   │   ├── store.ts          # Load/save/validate/merge config from JSON file
│   │   │   └── defaults.ts       # Default configuration values
│   │   ├── ws/
│   │   │   ├── handler.ts        # WebSocket message router
│   │   │   └── types.ts          # Message type definitions
│   │   ├── network/
│   │   │   ├── interfaces.ts     # List available network interfaces
│   │   │   ├── mdns.ts           # mDNS service publication
│   │   │   └── certificate.ts    # Self-signed cert generation + caching
│   │   └── utils/
│   │       └── logger.ts         # Structured logging (stdout for Tauri to capture)
│   ├── package.json
│   ├── tsconfig.json
│   └── build.ts                  # Build script: compile + rename with target triple
├── package.json                  # Root: workspace scripts
└── config.json                   # Runtime config file (next to executable in production)
```

### Pattern 1: Sidecar Lifecycle Management (from Tauri Rust side)

**What:** Tauri spawns the Node.js sidecar on app launch, monitors it via stdout/stderr events, auto-restarts on crash, and cleanly kills on app exit.

**When to use:** Always -- this is the core lifecycle pattern.

**Example:**
```rust
// Source: https://v2.tauri.app/develop/sidecar/ + https://v2.tauri.app/reference/javascript/shell/
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn spawn_sidecar(app: &tauri::AppHandle, should_run: Arc<AtomicBool>) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while should_run.load(Ordering::SeqCst) {
            let sidecar_cmd = app_handle
                .shell()
                .sidecar("server")
                .expect("failed to create sidecar command");

            let (mut rx, child) = sidecar_cmd
                .spawn()
                .expect("failed to spawn sidecar");

            // Forward stdout/stderr to frontend as events
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let msg = String::from_utf8_lossy(&line);
                        let _ = app_handle.emit("sidecar-log", &*msg);
                    }
                    CommandEvent::Stderr(line) => {
                        let msg = String::from_utf8_lossy(&line);
                        let _ = app_handle.emit("sidecar-error", &*msg);
                    }
                    CommandEvent::Error(err) => {
                        let _ = app_handle.emit("sidecar-crash", &err);
                        break; // Exit inner loop to trigger restart
                    }
                    CommandEvent::Terminated(payload) => {
                        let _ = app_handle.emit("sidecar-crash",
                            format!("Sidecar exited: code={:?}", payload.code));
                        break; // Exit inner loop to trigger restart
                    }
                    _ => {}
                }
            }

            if should_run.load(Ordering::SeqCst) {
                // Brief delay before restart to avoid tight crash loops
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    });
}
```

### Pattern 2: Express + HTTPS + WebSocket on Single Port

**What:** Create one HTTPS server that serves both Express routes and WebSocket upgrade requests on port 7777.

**When to use:** Always -- single port simplifies configuration and firewall rules.

**Example:**
```typescript
// Source: ws docs + Express docs + Node.js https module
import https from 'node:https';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { loadOrGenerateCert } from './network/certificate';

const app = express();
const { key, cert } = await loadOrGenerateCert();

const server = https.createServer({ key, cert }, app);
const wss = new WebSocketServer({ server });

// Express routes
app.get('/api/status', (req, res) => {
    res.json({ status: 'running', version: '1.0.0' });
});

// Serve static frontend files
app.use(express.static('public'));

// WebSocket connections
wss.on('connection', (ws, req) => {
    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg);
    });
});

server.listen(config.port, config.host, () => {
    console.log(`Server listening on https://${config.host}:${config.port}`);
});
```

### Pattern 3: Admin GUI as WebSocket Client (Discretion Decision)

**What:** The Tauri webview connects to the Node.js sidecar via the same WebSocket endpoint that browser clients use. No special Tauri IPC channel for admin commands.

**Why this approach:** The architecture decision states "Admin GUI is just another client connecting to Node.js server via same WebSocket/HTTP API as Web UI." Using Tauri IPC would create a parallel communication path that diverges from this principle. By connecting via WebSocket:
- Admin UI code is identical whether running in Tauri or a browser
- Testing is simpler (just open a browser)
- No Rust command handlers needed for admin operations
- Future browser-only admin mode requires zero code changes

**CSP requirement:** Configure Tauri's CSP to allow WebSocket connections to localhost:
```json
{
    "app": {
        "security": {
            "csp": "default-src 'self'; connect-src 'self' wss://localhost:* wss://127.0.0.1:* https://localhost:* https://127.0.0.1:*; style-src 'self' 'unsafe-inline'"
        }
    }
}
```

### Pattern 4: WebSocket Message Format (Discretion Decision)

**What:** Use a single WebSocket endpoint at `/ws` with JSON messages following `{ type, payload, requestId? }` convention. Clients identify their role on first message.

**Why single endpoint:** Separate `/ws/admin` and `/ws/listener` endpoints provide no real security benefit (no auth in v1) and complicate the server code. A single endpoint with role identification is simpler:

```typescript
// Message format
interface WsMessage {
    type: string;          // e.g., "identify", "config:get", "config:update", "status:subscribe"
    payload?: unknown;     // Type-specific data
    requestId?: string;    // For request/response correlation (optional)
}

// Role identification on connect
interface IdentifyPayload {
    role: 'admin' | 'listener';
    clientId?: string;     // Optional, server assigns if not provided
}

// Example message types:
// Admin: "identify", "config:get", "config:update", "server:restart", "logs:subscribe"
// Listener: "identify", "channels:list", "channel:join", "channel:leave"
// Server->Client: "config:updated", "status:changed", "log:entry", "error"
```

### Pattern 5: Config Store with Zod Validation

**What:** Zod schema defines the config shape, generates TypeScript types, and validates on load. Corrupt configs reset to defaults.

**Example:**
```typescript
import { z } from 'zod';

export const ConfigSchema = z.object({
    server: z.object({
        port: z.number().int().min(1024).max(65535).default(7777),
        host: z.string().ip().default('0.0.0.0'),
        interface: z.string().optional(), // Network interface name
    }),
    network: z.object({
        mdns: z.object({
            enabled: z.boolean().default(true),
            domain: z.string().default('churchaudio.local'),
        }),
        hostsFile: z.object({
            enabled: z.boolean().default(false),
            domain: z.string().default('churchaudio.local'),
        }),
    }),
    certificate: z.object({
        certPath: z.string().default('cert.pem'),
        keyPath: z.string().default('key.pem'),
    }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
export const defaultConfig: AppConfig = ConfigSchema.parse({});
```

### Anti-Patterns to Avoid

- **Tauri IPC for admin commands:** Do NOT create Rust `#[tauri::command]` handlers that proxy to the Node.js sidecar. The admin GUI connects directly via WebSocket. Tauri's only responsibility is launching/monitoring the sidecar.
- **Socket.IO for signaling:** Do NOT use Socket.IO. It adds unnecessary abstraction (rooms, namespaces, polling fallback) and increases bundle size. Raw ws is sufficient and lighter.
- **Global config singleton:** Do NOT use a mutable global config object. Use a ConfigStore class that loads from disk, validates with Zod, and exposes methods for reading and updating. Changes are applied through explicit save().
- **Binding to 0.0.0.0 by default:** The user explicitly decided against this. Default should be a specific interface (first non-loopback IPv4), with the admin selecting the interface in settings.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Self-signed certificates | Custom OpenSSL wrapper or crypto code | `selfsigned` v5 | Handles key generation, extensions, SANs, PEM formatting. Edge cases around certificate validity, key types, X.509 extensions |
| mDNS/Bonjour advertisement | Manual multicast DNS packet construction | `bonjour-service` | mDNS protocol has many subtleties (TTL, cache invalidation, probe conflicts). Pure JS, no native deps |
| Config schema validation | Manual if/else validation chains | `Zod` | Type inference, error messages, default values, nested objects, transforms -- all declarative. Custom validation code grows unwieldy fast |
| Hosts file manipulation | Direct fs.writeFile to hosts file | `hostile` | Platform-specific file paths, preserving existing entries, comment handling, atomic writes |
| WebSocket protocol handling | Custom TCP socket + upgrade logic | `ws` | Protocol compliance (masking, framing, extensions, close codes), backpressure, binary support |
| Binary compilation | Custom bundling scripts | `@yao-pkg/pkg` | Handles Node.js runtime embedding, snapshot generation, asset bundling, cross-platform output |
| Network interface enumeration | Platform-specific system calls | `os.networkInterfaces()` | Built into Node.js. Returns all interfaces with address, family, MAC, internal flag, CIDR notation |

**Key insight:** Every "simple" networking task (certificates, mDNS, hosts files) has platform-specific edge cases that are already solved by mature libraries. Building custom solutions wastes time and introduces bugs that surface only on specific OSes.

## Common Pitfalls

### Pitfall 1: Tauri HTTPS/WSS Mixed Content Blocking
**What goes wrong:** Tauri loads the webview over `https://tauri.localhost/` by default. Browser security blocks `ws://` (insecure WebSocket) connections from an HTTPS page.
**Why it happens:** Standard mixed-content security policy.
**How to avoid:** The sidecar runs HTTPS + WSS (not HTTP + WS). The self-signed certificate serves both. Configure CSP with `wss://localhost:*` and `wss://127.0.0.1:*` in connect-src.
**Warning signs:** Console errors "An insecure WebSocket connection may not be initiated from a page loaded over HTTPS" in dev tools.

### Pitfall 2: Sidecar Process Orphaning on Windows
**What goes wrong:** When Tauri app is closed via the GUI (clicking X), the sidecar process continues running in the background.
**Why it happens:** Windows process tree management differs from Unix. Tauri's built-in cleanup may not always work, especially on forced close or crash.
**How to avoid:** Implement a dual cleanup strategy: (1) Handle Tauri's `close_requested` event to explicitly kill the sidecar Child, (2) In the sidecar, detect when stdin closes (parent died) and self-terminate with a grace period.
**Warning signs:** Multiple Node.js processes in Task Manager after closing the app multiple times.

### Pitfall 3: Self-Signed Certificate Trust on iOS Safari
**What goes wrong:** iOS Safari refuses to connect to WSS endpoints with self-signed certificates and shows no clear error message.
**Why it happens:** iOS has strict certificate validation. Unlike desktop browsers, there's no "proceed anyway" option for WebSocket connections.
**How to avoid:** Serve a certificate download page at `https://IP:7777/trust` with a `.mobileconfig` profile for iOS, or clear instructions to add the cert exception in iOS Settings. Design the trust flow as a one-time onboarding step.
**Warning signs:** iPhone users can't connect. No error visible -- just silent failure.

### Pitfall 4: Config File Location Portability
**What goes wrong:** Config file path resolution breaks when app is moved to a different directory, or when running from a USB drive.
**Why it happens:** Using `__dirname` or `process.cwd()` resolves differently depending on how the binary was launched (from file manager, terminal, shortcut, etc.).
**How to avoid:** Resolve config path relative to the executable's actual location: `path.dirname(process.execPath)`. For pkg-compiled binaries, `process.execPath` points to the compiled binary, not the Node.js runtime.
**Warning signs:** Config changes not persisting, default config being regenerated on every launch.

### Pitfall 5: pkg Binary Not Found Due to Target Triple Mismatch
**What goes wrong:** `tauri dev` or `tauri build` fails with "sidecar not found" errors.
**Why it happens:** Tauri requires sidecar binaries to be named with the exact target triple suffix (e.g., `server-x86_64-pc-windows-msvc.exe`). A mismatch in the suffix causes lookup failures.
**How to avoid:** Use `rustc --print host-tuple` (Rust 1.84+) or `rustc -Vv | grep host` to get the exact target triple. Create a build script that automatically renames the compiled binary with the correct suffix.
**Warning signs:** "Failed to find sidecar" errors in Tauri build output.

### Pitfall 6: Port Conflicts on Server Restart
**What goes wrong:** Changing the port in settings and clicking "Save" fails because the old server instance hasn't fully released the port.
**Why it happens:** TCP `TIME_WAIT` state keeps the port occupied for a short period after the socket closes. Also, if the server restart is not properly sequenced (close old, then start new), both try to bind simultaneously.
**How to avoid:** Implement a sequential restart: (1) Close all WebSocket connections with code 1012 (Service Restart), (2) Close the HTTP server and wait for the 'close' event, (3) Start new server on new port. Set `SO_REUSEADDR` via `server.listen()` options. Add a brief delay (500ms) between close and rebind.
**Warning signs:** "EADDRINUSE" errors in sidecar logs after changing port.

### Pitfall 7: Hosts File Requires Admin Privileges
**What goes wrong:** The `hostile` library fails silently or throws permission errors when trying to update the hosts file.
**Why it happens:** Modifying the hosts file requires administrator/root privileges on all platforms.
**How to avoid:** The sidecar cannot elevate privileges on its own. Options: (1) Make hosts file editing optional and off by default, (2) Show clear instructions to the admin about running the app with elevated privileges if they want this feature, (3) Use mDNS as the primary discovery mechanism (no privilege needed). The CONTEXT.md says to "update the PC's hosts file" but this should be a best-effort feature with clear error messaging.
**Warning signs:** Config says hosts file is enabled but domain doesn't resolve. No error shown to admin.

## Code Examples

### Self-Signed Certificate Generation with SANs
```typescript
// Source: selfsigned npm docs + GitHub README
import { generate } from 'selfsigned';

interface CertResult {
    key: string;
    cert: string;
}

export async function generateCertificate(
    ipAddresses: string[],
    domain: string
): Promise<CertResult> {
    const attrs = [{ name: 'commonName', value: domain }];

    const altNames = [
        { type: 2, value: domain },                    // DNS
        { type: 2, value: 'localhost' },                // DNS
        ...ipAddresses.map(ip => ({ type: 7, ip })),   // IP addresses
    ];

    const pems = await generate(attrs, {
        keySize: 2048,
        days: 3650,     // 10 years -- local-only, no rotation needed
        algorithm: 'sha256',
        extensions: [
            {
                name: 'subjectAltName',
                altNames,
            },
        ],
    });

    return { key: pems.private, cert: pems.cert };
}
```

### Config Store with Zod Validation and Graceful Corruption Handling
```typescript
// Source: Zod docs + Node.js fs
import fs from 'node:fs';
import path from 'node:path';
import { ConfigSchema, type AppConfig, defaultConfig } from './schema';

export class ConfigStore {
    private config: AppConfig;
    private configPath: string;

    constructor(basePath: string) {
        this.configPath = path.join(basePath, 'config.json');
        this.config = this.load();
    }

    private load(): AppConfig {
        try {
            const raw = fs.readFileSync(this.configPath, 'utf-8');
            const parsed = JSON.parse(raw);
            const result = ConfigSchema.safeParse(parsed);

            if (result.success) {
                return result.data;
            }

            // Config invalid -- log warning, use defaults
            console.warn(`[config] Invalid config, resetting to defaults: ${
                result.error.issues.map(i => i.message).join(', ')
            }`);
            this.save(defaultConfig);
            return { ...defaultConfig };
        } catch (err) {
            // File missing or corrupt JSON -- use defaults
            console.warn(`[config] Cannot read config, using defaults: ${err}`);
            this.save(defaultConfig);
            return { ...defaultConfig };
        }
    }

    get(): AppConfig {
        return structuredClone(this.config);
    }

    update(partial: Partial<AppConfig>): { success: boolean; config: AppConfig; errors?: string[] } {
        const merged = { ...this.config, ...partial };
        const result = ConfigSchema.safeParse(merged);

        if (!result.success) {
            return {
                success: false,
                config: this.config,
                errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
            };
        }

        this.config = result.data;
        this.save(this.config);
        return { success: true, config: this.config };
    }

    private save(config: AppConfig): void {
        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    }
}
```

### Sidecar Spawn from Tauri Frontend
```typescript
// Source: https://v2.tauri.app/reference/javascript/shell/
import { Command } from '@tauri-apps/plugin-shell';

export async function startSidecar(): Promise<void> {
    const command = Command.sidecar('binaries/server');

    command.stdout.on('data', (line: string) => {
        console.log('[sidecar]', line);
        // Forward to log viewer in admin UI
    });

    command.stderr.on('data', (line: string) => {
        console.error('[sidecar:err]', line);
    });

    command.on('error', (error: string) => {
        console.error('[sidecar:crash]', error);
        // Trigger restart logic
    });

    command.on('close', (data) => {
        console.warn('[sidecar:exit]', data.code);
        // Trigger restart logic if not intentional
    });

    await command.spawn();
}
```

### Network Interface Enumeration
```typescript
// Source: Node.js os module docs
import os from 'node:os';

interface NetworkInterface {
    name: string;
    address: string;
    family: 'IPv4' | 'IPv6';
    mac: string;
    internal: boolean;
}

export function listNetworkInterfaces(): NetworkInterface[] {
    const interfaces = os.networkInterfaces();
    const results: NetworkInterface[] = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) {
                results.push({
                    name,
                    address: addr.address,
                    family: addr.family as 'IPv4',
                    mac: addr.mac,
                    internal: addr.internal,
                });
            }
        }
    }

    return results;
}

export function getDefaultInterface(): NetworkInterface | undefined {
    const interfaces = listNetworkInterfaces();
    return interfaces[0]; // First non-loopback IPv4 interface
}
```

### mDNS Service Publication
```typescript
// Source: bonjour-service npm README
import Bonjour from 'bonjour-service';

let bonjourInstance: InstanceType<typeof Bonjour> | null = null;

export function publishService(port: number, domain: string): void {
    unpublishService(); // Clean up any existing publication

    bonjourInstance = new Bonjour();
    bonjourInstance.publish({
        name: domain.replace('.local', ''),
        type: 'http',
        port,
        txt: {
            path: '/',
            protocol: 'https',
        },
    });
}

export function unpublishService(): void {
    if (bonjourInstance) {
        bonjourInstance.unpublishAll();
        bonjourInstance.destroy();
        bonjourInstance = null;
    }
}
```

### WebSocket Heartbeat Pattern
```typescript
// Source: ws docs + community patterns
import { WebSocketServer, WebSocket } from 'ws';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10_000;  // 10 seconds to respond

function setupHeartbeat(wss: WebSocketServer): void {
    const interval = setInterval(() => {
        for (const ws of wss.clients) {
            const extWs = ws as WebSocket & { isAlive: boolean };
            if (!extWs.isAlive) {
                extWs.terminate();
                continue;
            }
            extWs.isAlive = false;
            extWs.ping();
        }
    }, HEARTBEAT_INTERVAL);

    wss.on('close', () => clearInterval(interval));

    wss.on('connection', (ws) => {
        const extWs = ws as WebSocket & { isAlive: boolean };
        extWs.isAlive = true;
        extWs.on('pong', () => { extWs.isAlive = true; });
    });
}
```

### Server Restart on Config Change
```typescript
// Source: Node.js https module + custom pattern
import https from 'node:https';
import { WebSocket } from 'ws';

export async function restartServer(
    currentServer: https.Server,
    wss: import('ws').WebSocketServer,
    newConfig: { host: string; port: number; key: string; cert: string }
): Promise<https.Server> {
    // 1. Notify all connected clients
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'server:restarting',
                payload: { newPort: newConfig.port, newHost: newConfig.host },
            }));
            client.close(1012, 'Service Restart');
        }
    }

    // 2. Close existing server
    await new Promise<void>((resolve) => {
        currentServer.close(() => resolve());
    });

    // 3. Brief delay for port release
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 4. Create new server with updated config
    const newServer = https.createServer(
        { key: newConfig.key, cert: newConfig.cert },
        app // Express app reference
    );

    // 5. Reattach WebSocket server
    wss.close();
    // Recreate WSS with new server...

    await new Promise<void>((resolve) => {
        newServer.listen(newConfig.port, newConfig.host, () => resolve());
    });

    return newServer;
}
```

### Tauri Configuration (tauri.conf.json)
```json
{
    "$schema": "https://raw.githubusercontent.com/nicoverbruggen/tauri-conf-schema/refs/heads/main/schema.json",
    "productName": "ChurchAudioStream",
    "identifier": "com.churchaudiostream.app",
    "version": "0.1.0",
    "build": {
        "frontendDist": "../dist",
        "devUrl": "http://localhost:5173",
        "beforeBuildCommand": "npm run build",
        "beforeDevCommand": "npm run dev"
    },
    "bundle": {
        "active": true,
        "targets": "all",
        "externalBin": ["binaries/server"],
        "resources": []
    },
    "app": {
        "windows": [
            {
                "label": "main",
                "title": "Church Audio Stream",
                "width": 1200,
                "height": 800,
                "resizable": true
            }
        ],
        "security": {
            "csp": "default-src 'self'; connect-src 'self' wss://localhost:* wss://127.0.0.1:* https://localhost:* https://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
        }
    }
}
```

### Sidecar Permission Configuration (capabilities/default.json)
```json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "main-capability",
    "description": "Main window capabilities",
    "windows": ["main"],
    "permissions": [
        "core:default",
        {
            "identifier": "shell:allow-spawn",
            "allow": [
                {
                    "name": "binaries/server",
                    "sidecar": true,
                    "args": true
                }
            ]
        },
        "shell:allow-kill"
    ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express 4.x | Express 5.x (now default on npm) | Mar 2025 | Promise-based error handling, regex route params removed, new path matching. Use Express 5 |
| vercel/pkg | @yao-pkg/pkg (community fork) | 2023 | vercel/pkg deprecated. yao-pkg supports Node 20. Use @yao-pkg/pkg 6.x |
| selfsigned sync API | selfsigned 5.x async-only | 2024 | generate() returns Promise. All code must use async/await |
| Tauri 1.x IPC | Tauri 2.x plugin system | Oct 2024 | Shell commands moved to @tauri-apps/plugin-shell. Must add plugin + capabilities |
| Tauri 1.x allowlist | Tauri 2.x capabilities | Oct 2024 | Security model changed from allowlist to capabilities-based. Config structure different |
| Zod 3.x | Zod 4.x | 2025 | New features, performance improvements. Minor API changes from v3 |

**Deprecated/outdated:**
- `vercel/pkg`: Deprecated. Use `@yao-pkg/pkg` instead
- Express 4.x: Still supported but Express 5 is the default on npm since March 2025
- Tauri 1.x `allowlist` in tauri.conf.json: Replaced by `capabilities/` directory in Tauri 2
- `selfsigned` synchronous API: Removed in v5. Must use async

## Open Questions

1. **mediasoup Native Worker Compatibility with pkg**
   - What we know: mediasoup has a C++ worker binary that cannot be bundled inside a pkg executable. The `MEDIASOUP_WORKER_BIN` env var allows specifying an external path to the worker binary. Phase 1 does not include mediasoup.
   - What's unclear: Whether the Phase 1 sidecar architecture (pkg-compiled binary) will need to be restructured when mediasoup is added in Phase 4. It may be easier to ship raw Node.js + bundled JS + native modules rather than a pkg binary.
   - Recommendation: For Phase 1, use pkg for clean sidecar compilation. Design the build system so switching to "node.exe + bundled JS" approach is straightforward if pkg proves incompatible with mediasoup. Keep this as a known risk.

2. **Hosts File Editing Privilege Escalation**
   - What we know: Editing the hosts file requires admin/root privileges. The `hostile` library needs elevated permissions. The Tauri app runs as a normal user.
   - What's unclear: How to gracefully handle the privilege requirement across platforms (Windows UAC, macOS sudo, Linux pkexec).
   - Recommendation: Make hosts file editing opt-in and disabled by default. When enabled, detect permission failure and show clear instructions to the user. mDNS is the primary discovery mechanism and doesn't need privileges.

3. **Tauri Webview Self-Signed Certificate Trust**
   - What we know: The Tauri webview (WebView2 on Windows, WebKit on macOS/Linux) needs to connect to the sidecar's WSS endpoint. Self-signed certs may be rejected.
   - What's unclear: Whether the Tauri webview shares the OS certificate store or has its own trust policy. Whether `rejectUnauthorized: false` can be set.
   - Recommendation: Test during implementation. The Tauri webview connects to `wss://localhost:7777` -- localhost connections may have relaxed cert requirements. If cert trust is an issue, the webview could connect via `ws://` using `dangerousUseHttpScheme` security setting as a fallback.

4. **Sidecar Environment Variables at Runtime**
   - What we know: Tauri's shell plugin can pass arguments to sidecars, but passing custom environment variables at runtime is not well-documented (GitHub issue #12693).
   - What's unclear: Whether the sidecar inherits the parent Tauri process's environment variables, and whether we can set custom ones.
   - Recommendation: Pass configuration via command-line arguments (e.g., `--config-path /path/to/config.json`) rather than environment variables. This is more portable and well-supported by Tauri.

## Sources

### Primary (HIGH confidence)
- [Tauri 2 Sidecar Guide](https://v2.tauri.app/learn/sidecar-nodejs/) - Complete Node.js sidecar setup
- [Tauri 2 External Binaries](https://v2.tauri.app/develop/sidecar/) - externalBin configuration, target triple naming, permissions
- [Tauri 2 Shell Plugin](https://v2.tauri.app/plugin/shell/) - Plugin installation, capabilities, spawn/execute API
- [Tauri 2 Shell JS API](https://v2.tauri.app/reference/javascript/shell/) - Command class, Child class, event handling
- [Tauri 2 Configuration Reference](https://v2.tauri.app/reference/config/) - tauri.conf.json structure, bundle, security settings
- [Tauri 2 Create Project](https://v2.tauri.app/start/create-project/) - Scaffolding commands and options
- [Express 5.1 Release](https://expressjs.com/2025/03/31/v5-1-latest-release.html) - Express 5 now default on npm

### Secondary (MEDIUM confidence)
- [ws npm package](https://www.npmjs.com/package/ws) - Version 8.19.0, API reference
- [selfsigned npm](https://www.npmjs.com/package/selfsigned) - v5 async API, SAN extensions
- [bonjour-service npm](https://www.npmjs.com/package/bonjour-service) - v1.3.0, pure JS mDNS
- [@yao-pkg/pkg npm](https://www.npmjs.com/package/@yao-pkg/pkg) - v6.12.0, Node 20 support
- [Zod GitHub](https://github.com/colinhacks/zod) - v4.3.5, TypeScript-first validation
- [hostile npm](https://www.npmjs.com/package/hostile) - Hosts file manipulation
- [Tauri sidecar lifecycle issue](https://github.com/tauri-apps/plugins-workspace/issues/3062) - Sidecar process management challenges
- [mediasoup installation docs](https://mediasoup.org/documentation/v3/mediasoup/installation/) - MEDIASOUP_WORKER_BIN env var

### Tertiary (LOW confidence)
- [Tauri sidecar manager plugin](https://github.com/radical-data/tauri-sidecar-manager) - Community plugin for sidecar lifecycle, not verified for production use
- [Node.js SEA improvements](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/) - Node 25.5 --build-sea flag, too new for production use

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified through official docs and npm. Versions confirmed current.
- Architecture: HIGH - Tauri sidecar pattern is well-documented. Express + ws pattern is established. WebSocket message format is a standard convention.
- Pitfalls: HIGH - Sidecar orphaning, HTTPS mixed content, and cert trust issues are all documented in Tauri GitHub issues. Config path resolution is a known pkg behavior.
- Discretion decisions: MEDIUM - Communication mechanism (WebSocket vs IPC) and endpoint structure (single vs separate) are architectural choices informed by the "admin GUI is just another client" principle but not validated by production examples of this exact pattern.

**Research date:** 2026-02-05
**Valid until:** 2026-03-07 (30 days - stack is stable, Tauri 2.x is mature)
