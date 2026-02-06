import { execSync } from "node:child_process";
import { logger } from "../utils/logger";

const FIREWALL_RULE_NAME = "ChurchAudioStream";

/**
 * Detect whether the current process has Windows administrator elevation.
 * Uses the standard `net session` technique: it succeeds only when elevated.
 */
function isRunningElevated(): boolean {
  try {
    execSync("net session", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the netsh command string for manual copy-paste by the user.
 */
function buildManualNetshCommand(port: number): string {
  return `netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=private,domain`;
}

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

    const elevated = isRunningElevated();

    if (!elevated) {
      logger.warn("Firewall rule requires administrator privileges. Phone connections may be blocked.", {
        port,
        manualCommand: buildManualNetshCommand(port),
        instructions: "Open PowerShell as Administrator and run the command above, OR right-click the app and choose 'Run as administrator' for one-time setup.",
      });
      return;
    }

    deleteExistingRule();
    createFirewallRule(port);

    // Verify the rule was actually created
    if (firewallRuleMatchesPort(port)) {
      logger.info("Windows Firewall rule created and verified", { port, ruleName: FIREWALL_RULE_NAME });
    } else {
      logger.warn("Firewall rule was created but verification failed. The rule may not have been applied correctly.", {
        port,
        ruleName: FIREWALL_RULE_NAME,
        manualCommand: buildManualNetshCommand(port),
        instructions: "Try running the manual command above in an elevated PowerShell to ensure the rule exists.",
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Firewall rule creation failed despite having admin privileges.", {
      port,
      error: errorMessage,
      manualCommand: buildManualNetshCommand(port),
      instructions: "Try running the manual command above in an elevated PowerShell.",
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
