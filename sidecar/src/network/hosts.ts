import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { logger } from "../utils/logger";

const HOSTS_FILE_TAG = "# ChurchAudioStream";
const HOSTS_PATH_WINDOWS = "C:\\Windows\\System32\\drivers\\etc\\hosts";
const HOSTS_PATH_UNIX = "/etc/hosts";

const ELEVATED_COMMAND_TIMEOUT_MS = 30_000;

function getHostsFilePath(): string {
  return process.platform === "win32" ? HOSTS_PATH_WINDOWS : HOSTS_PATH_UNIX;
}

function readHostsFile(): string {
  try {
    return fs.readFileSync(getHostsFilePath(), "utf-8");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Unable to read hosts file", { path: getHostsFilePath(), error: errorMessage });
    return "";
  }
}

function findExistingEntry(hostsContent: string): { line: string; ip: string; domain: string } | null {
  for (const line of hostsContent.split("\n")) {
    if (line.trimEnd().endsWith(HOSTS_FILE_TAG)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        return { line: line.trimEnd(), ip: parts[0], domain: parts[1] };
      }
    }
  }
  return null;
}

function buildHostsLine(ipAddress: string, domain: string): string {
  return `${ipAddress} ${domain} ${HOSTS_FILE_TAG}`;
}

function buildUpdatedHostsContent(currentContent: string, newLine: string): string {
  const lines = currentContent.split("\n");
  const filtered = lines.filter((line) => !line.trimEnd().endsWith(HOSTS_FILE_TAG));
  const content = filtered.join("\n").replace(/\n*$/, "\n");
  return content + newLine + "\n";
}

function buildRemovedHostsContent(currentContent: string): string {
  const lines = currentContent.split("\n");
  const filtered = lines.filter((line) => !line.trimEnd().endsWith(HOSTS_FILE_TAG));
  return filtered.join("\n");
}

function writeHostsFileElevated(newContent: string): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-hosts-"));
  const tempFile = path.join(tempDir, "hosts");

  try {
    fs.writeFileSync(tempFile, newContent, "utf-8");
    const hostsPath = getHostsFilePath();
    const execOptions = { stdio: "pipe" as const, timeout: ELEVATED_COMMAND_TIMEOUT_MS };

    if (process.platform === "win32") {
      const escapedTemp = tempFile.replace(/'/g, "''");
      const escapedHosts = hostsPath.replace(/'/g, "''");
      const innerCommand = `Copy-Item -Path '${escapedTemp}' -Destination '${escapedHosts}' -Force`;
      const outerCommand =
        `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command "${innerCommand}"'`;
      execSync(`powershell -NoProfile -Command "${outerCommand}"`, execOptions);
    } else if (process.platform === "darwin") {
      const escapedTemp = tempFile.replace(/'/g, "'\\''");
      const escapedHosts = hostsPath.replace(/'/g, "'\\''");
      execSync(
        `osascript -e 'do shell script "cp '\\''${escapedTemp}'\\'' '\\''${escapedHosts}'\\''" with administrator privileges'`,
        execOptions,
      );
    } else {
      // Linux: try pkexec, fall back to warning with manual command
      try {
        execSync("which pkexec", { stdio: "pipe" });
        execSync(`pkexec cp "${tempFile}" "${hostsPath}"`, execOptions);
      } catch {
        logger.warn(
          "pkexec not available. Run manually to update hosts file",
          { command: `sudo cp "${tempFile}" "${hostsPath}"` },
        );
        throw new Error("No elevation method available (pkexec not found)");
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Elevated hosts file write failed", { error: errorMessage });
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function ensureHostsEntry(ipAddress: string, domain: string): void {
  const currentContent = readHostsFile();
  const existingEntry = findExistingEntry(currentContent);

  if (existingEntry && existingEntry.ip === ipAddress && existingEntry.domain === domain) {
    logger.info("Hosts entry already current", { ip: ipAddress, domain });
    return;
  }

  const newLine = buildHostsLine(ipAddress, domain);
  const updatedContent = buildUpdatedHostsContent(currentContent, newLine);

  writeHostsFileElevated(updatedContent);
  logger.info("Hosts file updated", { ip: ipAddress, domain });
}

export function removeHostsEntry(): void {
  const currentContent = readHostsFile();
  const existingEntry = findExistingEntry(currentContent);

  if (!existingEntry) {
    return;
  }

  const cleanedContent = buildRemovedHostsContent(currentContent);

  writeHostsFileElevated(cleanedContent);
  logger.info("Hosts file entry removed");
}
