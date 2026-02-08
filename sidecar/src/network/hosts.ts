import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { logger } from "../utils/logger";
import { toErrorMessage } from "../utils/error-message";

const HOSTS_FILE_TAG = "# ChurchAudioStream";
const HOSTS_PATH_WINDOWS = "C:\\Windows\\System32\\drivers\\etc\\hosts";
const HOSTS_PATH_UNIX = "/etc/hosts";

const ELEVATED_COMMAND_TIMEOUT_MS = 30_000;
const SENTINEL_POLL_INTERVAL_MS = 500;
const VBS_ELEVATION_SUCCESS = "ELEVATION_SUCCESS";

function getHostsFilePath(): string {
  return process.platform === "win32" ? HOSTS_PATH_WINDOWS : HOSTS_PATH_UNIX;
}

function readHostsFile(): string {
  try {
    return fs.readFileSync(getHostsFilePath(), "utf-8");
  } catch (error) {
    const errorMessage = toErrorMessage(error);
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

/**
 * Build a VBScript that triggers UAC elevation via Shell.Application.ShellExecute.
 *
 * Why VBScript + windowsHide:false?
 * Tauri spawns the sidecar with CREATE_NO_WINDOW. This flag is inherited by
 * all child processes and prevents the UAC consent dialog from displaying.
 * Launching cscript via spawnSync({windowsHide: false}) overrides this flag.
 *
 * The elevated command is a plain-text .ps1 script file so users and
 * security tools can inspect exactly what runs with admin rights.
 */
function buildElevationVbsContent(ps1ScriptPath: string, sentinelPath: string): string {
  const maxIterations = Math.ceil((ELEVATED_COMMAND_TIMEOUT_MS / 1000) * (1000 / SENTINEL_POLL_INTERVAL_MS));
  const escapedSentinelPath = sentinelPath.replace(/\\/g, "\\\\");
  const escapedPs1Path = ps1ScriptPath.replace(/\\/g, "\\\\");

  return [
    'Set shell = CreateObject("Shell.Application")',
    `shell.ShellExecute "powershell.exe", "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""${escapedPs1Path}""", "", "runas", 0`,
    "",
    "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
    `sentinelPath = "${escapedSentinelPath}"`,
    "waited = 0",
    `Do While Not fso.FileExists(sentinelPath) And waited < ${maxIterations}`,
    `  WScript.Sleep ${SENTINEL_POLL_INTERVAL_MS}`,
    "  waited = waited + 1",
    "Loop",
    "",
    "If fso.FileExists(sentinelPath) Then",
    `  WScript.Echo "${VBS_ELEVATION_SUCCESS}"`,
    "Else",
    '  WScript.Echo "ELEVATION_TIMEOUT"',
    "  WScript.Quit 1",
    "End If",
  ].join("\r\n");
}

/**
 * Build a PS1 script that adds/updates a ChurchAudioStream entry in the hosts file.
 *
 * The elevated script reads the hosts file directly (with admin rights),
 * removes any existing ChurchAudioStream lines, appends the new entry,
 * and writes everything in a single Set-Content call. Using a single write
 * avoids file lock contention: Windows Defender and the DNS Client service
 * can lock the hosts file immediately after a write, causing a subsequent
 * Add-Content to fail with "file in use."
 *
 * Uses single-quoted PS1 strings for tag/hostsLine to prevent accidental
 * variable interpolation of special characters (e.g. $ or `).
 * Includes post-write verification to confirm the entry was persisted.
 */
function buildAddEntryPs1(hostsPath: string, hostsLine: string, sentinelPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$hostsPath = '${hostsPath}'`,
    `$tag = '${HOSTS_FILE_TAG}'`,
    `$newLine = '${hostsLine}'`,
    `$sentinelPath = '${sentinelPath}'`,
    "",
    "try {",
    "  $content = Get-Content -Path $hostsPath",
    "  $filtered = @($content | Where-Object { -not $_.TrimEnd().EndsWith($tag) })",
    "  $finalLines = $filtered + $newLine",
    "  $finalLines | Set-Content -Path $hostsPath -Encoding ASCII",
    "",
    "  # Verify the entry was actually written",
    "  $verification = Get-Content -Path $hostsPath | Where-Object { $_.TrimEnd().EndsWith($tag) }",
    "  if (-not $verification) {",
    "    Set-Content -Path $sentinelPath -Value 'VERIFY_FAILED: entry not found after write'",
    "    exit 1",
    "  }",
    "",
    "  Set-Content -Path $sentinelPath -Value 'done'",
    "} catch {",
    "  Set-Content -Path $sentinelPath -Value \"ERROR: $($_.Exception.Message)\"",
    "  exit 1",
    "}",
  ].join("\r\n");
}

/**
 * Build a PS1 script that removes any ChurchAudioStream entry from the hosts file.
 */
function buildRemoveEntryPs1(hostsPath: string, sentinelPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$hostsPath = '${hostsPath}'`,
    `$tag = '${HOSTS_FILE_TAG}'`,
    `$sentinelPath = '${sentinelPath}'`,
    "",
    "try {",
    "  $content = Get-Content -Path $hostsPath",
    "  $filtered = @($content | Where-Object { -not $_.TrimEnd().EndsWith($tag) })",
    "  $filtered | Set-Content -Path $hostsPath -Encoding ASCII",
    "  Set-Content -Path $sentinelPath -Value 'done'",
    "} catch {",
    "  Set-Content -Path $sentinelPath -Value \"ERROR: $($_.Exception.Message)\"",
    "  exit 1",
    "}",
  ].join("\r\n");
}

type Ps1Builder = (sentinelPath: string) => string;

/**
 * Run an elevated PS1 script on Windows using VBScript + UAC.
 *
 * Takes a builder function that receives the sentinel path and returns PS1 content.
 * This ensures the sentinel path is known before the PS1 is generated.
 */
function runElevatedPs1Windows(buildPs1: Ps1Builder): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-hosts-"));

  try {
    const sentinelFile = path.join(tempDir, "done.txt");
    const ps1Content = buildPs1(sentinelFile);
    const ps1File = path.join(tempDir, "update-hosts.ps1");

    fs.writeFileSync(ps1File, ps1Content, "utf-8");

    const vbsContent = buildElevationVbsContent(ps1File, sentinelFile);
    const vbsFile = path.join(tempDir, "elevate.vbs");
    fs.writeFileSync(vbsFile, vbsContent, "utf-8");

    logger.info("Requesting admin elevation to update hosts file", {
      script: ps1File,
      command: ps1Content,
    });

    const spawnResult = spawnSync("cscript", ["//nologo", vbsFile], {
      stdio: "pipe",
      timeout: ELEVATED_COMMAND_TIMEOUT_MS + 5_000,
      windowsHide: false,
    });

    if (spawnResult.error) {
      throw spawnResult.error;
    }

    if (spawnResult.status !== 0) {
      const stderr = spawnResult.stderr?.toString().trim() ?? "";
      const stdout = spawnResult.stdout?.toString().trim() ?? "";
      throw new Error(
        `Elevation failed (exit code ${spawnResult.status}): ${stderr || stdout || "unknown error"}`,
      );
    }

    const result = spawnResult.stdout?.toString().trim() ?? "";
    if (result !== VBS_ELEVATION_SUCCESS) {
      throw new Error(`Elevation did not complete: ${result}`);
    }

    // Read sentinel to detect PS1-level errors (try/catch writes error info)
    const sentinelContent = fs.readFileSync(sentinelFile, "utf-8").trim();
    if (sentinelContent !== "done") {
      throw new Error(`Elevated script failed: ${sentinelContent}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runElevatedUnix(hostsPath: string, updatedContent: string): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-hosts-"));
  const tempFile = path.join(tempDir, "hosts");
  const execOptions = { stdio: "pipe" as const, timeout: ELEVATED_COMMAND_TIMEOUT_MS };

  try {
    fs.writeFileSync(tempFile, updatedContent, "utf-8");

    if (process.platform === "darwin") {
      execSync(
        `osascript -e 'do shell script "cp \\"${tempFile}\\" \\"${hostsPath}\\"" with administrator privileges'`,
        execOptions,
      );
    } else {
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
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Check whether the hosts file contains a current ChurchAudioStream entry
 * matching the given IP and domain. Used for startup verification.
 */
export function hostsEntryExists(ipAddress: string, domain: string): boolean {
  const currentContent = readHostsFile();
  const existingEntry = findExistingEntry(currentContent);
  return existingEntry !== null
    && existingEntry.ip === ipAddress
    && existingEntry.domain === domain;
}

export function ensureHostsEntry(ipAddress: string, domain: string): void {
  const currentContent = readHostsFile();
  const existingEntry = findExistingEntry(currentContent);

  if (existingEntry && existingEntry.ip === ipAddress && existingEntry.domain === domain) {
    logger.info("Hosts entry already current", { ip: ipAddress, domain });
    return;
  }

  const hostsPath = getHostsFilePath();
  const hostsLine = buildHostsLine(ipAddress, domain);

  try {
    if (process.platform === "win32") {
      runElevatedPs1Windows(
        (sentinelPath) => buildAddEntryPs1(hostsPath, hostsLine, sentinelPath),
      );
    } else {
      const lines = currentContent.split("\n");
      const filtered = lines.filter((line) => !line.trimEnd().endsWith(HOSTS_FILE_TAG));
      const content = filtered.join("\n").replace(/\n*$/, "\n");
      runElevatedUnix(hostsPath, content + hostsLine + "\n");
    }
    logger.info("Hosts file updated", { ip: ipAddress, domain });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    logger.warn("Failed to update hosts file", { error: errorMessage });
    throw error;
  }
}

export function removeHostsEntry(): void {
  const currentContent = readHostsFile();
  const existingEntry = findExistingEntry(currentContent);

  if (!existingEntry) {
    return;
  }

  const hostsPath = getHostsFilePath();

  try {
    if (process.platform === "win32") {
      runElevatedPs1Windows(
        (sentinelPath) => buildRemoveEntryPs1(hostsPath, sentinelPath),
      );
    } else {
      const lines = currentContent.split("\n");
      const filtered = lines.filter((line) => !line.trimEnd().endsWith(HOSTS_FILE_TAG));
      runElevatedUnix(hostsPath, filtered.join("\n"));
    }
    logger.info("Hosts file entry removed");
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    logger.warn("Failed to remove hosts file entry", { error: errorMessage });
    throw error;
  }
}
