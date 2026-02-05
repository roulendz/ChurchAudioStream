import { execSync } from "node:child_process";
import { logger } from "../utils/logger";

const FIREWALL_RULE_NAME = "ChurchAudioStream";

/**
 * Best-effort Windows Firewall rule creation for the sidecar HTTPS port.
 * On non-Windows platforms this is a no-op. On Windows, failures are logged
 * as warnings but never throw -- the application continues regardless.
 */
export async function ensureFirewallRule(port: number): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  try {
    if (firewallRuleMatchesPort(port)) {
      logger.info("Windows Firewall rule already exists for port", { port, ruleName: FIREWALL_RULE_NAME });
      return;
    }

    deleteExistingRule();
    createFirewallRule(port);

    logger.info("Windows Firewall rule created", { port, ruleName: FIREWALL_RULE_NAME });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Could not create Windows Firewall rule. Phone connections may be blocked.", {
      port,
      hint: "Run the application as Administrator, or manually add a firewall rule for TCP port " + port,
      error: errorMessage,
    });
  }
}

function firewallRuleMatchesPort(port: number): boolean {
  try {
    const output = execSync(
      `netsh advfirewall firewall show rule name="${FIREWALL_RULE_NAME}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return output.includes(`${port}`);
  } catch {
    // Rule does not exist -- netsh returns non-zero exit code
    return false;
  }
}

function deleteExistingRule(): void {
  try {
    execSync(
      `netsh advfirewall firewall delete rule name="${FIREWALL_RULE_NAME}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    // Rule may not exist yet -- safe to ignore
  }
}

function createFirewallRule(port: number): void {
  execSync(
    `netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=private,domain`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
  );
}
