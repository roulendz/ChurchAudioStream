import { logger } from "../utils/logger";

/**
 * Log a reminder about Windows Firewall behavior for the external HTTPS port.
 *
 * Windows automatically shows a "Windows Security Alert" dialog the first time
 * an executable listens on a network-facing port. The user clicks "Allow access"
 * once, and Windows creates a persistent inbound allow rule keyed to the
 * executable path. This works for the sidecar (server.exe) without any manual
 * netsh commands or administrator elevation.
 *
 * This function exists solely to emit a helpful log line. On non-Windows
 * platforms it is a silent no-op.
 */
export function logFirewallReminder(port: number): void {
  if (process.platform !== "win32") {
    return;
  }

  logger.info(
    "Windows Firewall: on first launch Windows will prompt to allow network access. " +
      "Accept the dialog so phones can reach the HTTPS server.",
    { port },
  );
}
