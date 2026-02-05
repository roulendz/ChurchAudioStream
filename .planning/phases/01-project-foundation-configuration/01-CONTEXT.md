# Phase 1: Project Foundation & Configuration - Context

**Gathered:** 2026-02-05
**Status:** Ready for planning

<domain>
## Phase Boundary

A running Tauri 2.x application with Node.js sidecar, Express web server, WebSocket signaling endpoint, and persistent JSON configuration. This is the skeleton that all subsequent phases build on. No audio capture, processing, or streaming — just the app shell, server, signaling, and config persistence.

</domain>

<decisions>
## Implementation Decisions

### Sidecar lifecycle
- Node.js sidecar auto-starts when Tauri app launches — no manual "Start Server" button
- If sidecar crashes: auto-restart immediately + show notification in admin UI so the sound tech knows something happened
- Sidecar logs are viewable in a dedicated log viewer panel in the admin UI (not just log files)
- Claude's Discretion: Communication method between Tauri GUI and Node.js sidecar (same WebSocket/HTTP as browser clients, or Tauri IPC — pick the best approach given the "admin GUI is just another client" architecture)

### Web server access
- Default port: **7777** (biblical — seven is the number of completion/perfection in Scripture, quadrupled)
- Network discovery: Both mDNS/Bonjour AND QR code/IP. Domain name is configurable in the admin GUI. Also update the PC's hosts file for the configured domain name
- Network interface: Admin selects which network interface to bind to (not 0.0.0.0 by default). Show available interfaces in settings
- HTTPS via self-signed certificate generated on first run. Provide clear trust instructions for users (one-time "trust this certificate" step). No Let's Encrypt — app runs on local WiFi, not internet-accessible

### Config structure & defaults
- First launch: Start immediately with sensible defaults — no setup wizard. Admin tweaks settings as needed from the dashboard
- Config file location: Next to the executable (not OS app data folder). Works for both installed and portable modes, easy to find and back up
- Corrupt/invalid config: Reset to defaults and show a warning notification to the admin. Service keeps running — never fail to start
- Config changes: Save/Apply button workflow — admin makes changes, reviews, then clicks Save to apply. Some settings (like port/interface) may require server restart

### WebSocket signaling shape
- No admin authentication in v1 — anyone on the local WiFi can access admin. Church network is trusted. Auth deferred to future version
- Always-visible connection status indicator in admin UI (connected/disconnected/reconnecting) so admin knows instantly if something's wrong
- Claude's Discretion: Endpoint structure (single endpoint with role identification vs separate /ws/admin and /ws/listener)
- Claude's Discretion: Message format and conventions (JSON {type, payload} or alternative)

### Claude's Discretion
- Tauri-to-sidecar communication mechanism
- WebSocket endpoint structure (single vs separate)
- WebSocket message format conventions
- Exact server restart behavior when port/interface changes
- Self-signed certificate generation approach and trust instruction flow

</decisions>

<specifics>
## Specific Ideas

- Port 7777 is intentionally biblical — the app is for churches, and seven represents completion/perfection in Scripture. This is an Easter egg for "hardcore OG Bible readers"
- Config next to executable is important for portability — churches may run this from a USB drive or shared folder
- Log viewer in admin UI is for the sound tech who shouldn't have to dig through files when something goes wrong during a service
- mDNS domain name should be configurable so churches can use their own name (e.g., `gracechurch.local`)

</specifics>

<deferred>
## Deferred Ideas

- Admin authentication — noted for future phase (v2 or if churches report issues with open admin access)
- Let's Encrypt / real certificates — only relevant if app ever needs internet-facing deployment

</deferred>

---

*Phase: 01-project-foundation-configuration*
*Context gathered: 2026-02-05*
