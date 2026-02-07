import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generate } from "selfsigned";
import type { AppConfig } from "../config/schema";
import { logger } from "../utils/logger";

const CA_COMMON_NAME = "ChurchAudioStream Local CA";
const CA_VALIDITY_YEARS = 20;

const ELEVATED_COMMAND_TIMEOUT_MS = 30_000;
const SENTINEL_POLL_INTERVAL_MS = 500;
const VBS_ELEVATION_SUCCESS = "ELEVATION_SUCCESS";

export interface CaCredentials {
  caCert: string;
  caKey: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the Root CA keypair exists on disk and is installed in the OS trust
 * store. Returns PEM strings for the CA cert and key, ready for signing
 * server certificates.
 *
 * Lifecycle:
 *  1. If CA files exist on disk, load them. Otherwise generate and save.
 *  2. Check if the CA is already trusted by the OS. If not, install it
 *     (triggers a UAC prompt on Windows).
 */
export async function ensureCaReady(
  basePath: string,
  config: AppConfig,
): Promise<CaCredentials> {
  const caCertFilePath = path.join(basePath, config.certificate.caCertPath);
  const caKeyFilePath = path.join(basePath, config.certificate.caKeyPath);

  let caCert: string;
  let caKey: string;

  if (fs.existsSync(caCertFilePath) && fs.existsSync(caKeyFilePath)) {
    logger.info("Loading existing Root CA from disk", {
      certPath: caCertFilePath,
      keyPath: caKeyFilePath,
    });
    caCert = fs.readFileSync(caCertFilePath, "utf-8");
    caKey = fs.readFileSync(caKeyFilePath, "utf-8");
  } else {
    logger.info("No Root CA found on disk, generating new CA keypair");
    const generated = await generateRootCa();
    caCert = generated.cert;
    caKey = generated.key;

    fs.writeFileSync(caCertFilePath, caCert, "utf-8");
    fs.writeFileSync(caKeyFilePath, caKey, "utf-8");
    logger.info("Root CA saved to disk", {
      certPath: caCertFilePath,
      keyPath: caKeyFilePath,
    });
  }

  if (process.platform === "win32") {
    if (!isCaInstalledInStore(caCert)) {
      logger.info(
        "Root CA not found in Windows Trusted Root store, installing (UAC prompt expected)",
      );
      installCaInStore(caCertFilePath);
      logger.info("Root CA successfully installed in Windows Trusted Root store");
    } else {
      logger.info("Root CA already trusted in Windows store, no UAC needed");
    }
  } else {
    logger.warn(
      "Non-Windows platform: Root CA must be manually trusted by the OS or browser. " +
        `Import the CA certificate from: ${caCertFilePath}`,
    );
  }

  return { caCert, caKey };
}

// ---------------------------------------------------------------------------
// CA Generation
// ---------------------------------------------------------------------------

/**
 * Generate a self-signed Root CA certificate with a 20-year validity.
 * The CA has basicConstraints(cA=true) and keyUsage(keyCertSign, cRLSign).
 */
export async function generateRootCa(): Promise<{ cert: string; key: string }> {
  const attributes = [{ name: "commonName", value: CA_COMMON_NAME }];

  const notBeforeDate = new Date();
  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + CA_VALIDITY_YEARS);

  const pems = await generate(attributes, {
    keySize: 2048,
    notBeforeDate,
    notAfterDate,
    extensions: [
      {
        name: "basicConstraints",
        cA: true,
        critical: true,
      },
      {
        name: "keyUsage",
        keyCertSign: true,
        cRLSign: true,
        critical: true,
      },
    ],
  });

  logger.info("Root CA keypair generated", {
    commonName: CA_COMMON_NAME,
    validYears: CA_VALIDITY_YEARS,
  });

  return { cert: pems.cert, key: pems.private };
}

// ---------------------------------------------------------------------------
// Store Detection (Windows)
// ---------------------------------------------------------------------------

/**
 * Check whether the CA certificate is already installed in the Windows
 * Trusted Root Certification Authorities store by searching for its CN.
 *
 * Returns false on any error (treat as "not installed").
 */
export function isCaInstalledInStore(caCertPem: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    // Use certutil to search by subject CN in the Root store
    const result = spawnSync(
      "certutil",
      ["-store", "Root", CA_COMMON_NAME],
      { stdio: "pipe", timeout: 10_000 },
    );

    if (result.status === 0) {
      // certutil found at least one cert matching the CN.
      // Verify the fingerprint matches to avoid false positives from a
      // different cert with the same CN.
      const x509 = new crypto.X509Certificate(caCertPem);
      const sha1Fingerprint = x509.fingerprint.replace(/:/g, "").toLowerCase();
      const certutilOutput = result.stdout?.toString().toLowerCase() ?? "";
      return certutilOutput.includes(sha1Fingerprint);
    }

    return false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to check CA store status, assuming not installed", {
      error: errorMessage,
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Store Installation (Windows, elevated)
// ---------------------------------------------------------------------------

/**
 * Install the Root CA certificate into the Windows Trusted Root
 * Certification Authorities store via an elevated PowerShell script.
 *
 * Triggers a UAC consent dialog. Uses the same VBScript+UAC elevation
 * pattern as hosts.ts (duplicated for SRP: each module owns its own
 * elevation concern with completely different PS1 content).
 */
export function installCaInStore(caCertFilePath: string): void {
  if (process.platform !== "win32") {
    logger.warn("installCaInStore is only supported on Windows");
    return;
  }

  runElevatedCaInstall(caCertFilePath);
}

/**
 * Remove the ChurchAudioStream Root CA from the Windows Trusted Root store.
 * Best-effort utility for explicit uninstall scenarios (not called during
 * normal shutdown -- the CA is intentionally persistent across restarts).
 */
export function removeCaFromStore(): void {
  if (process.platform !== "win32") {
    logger.warn("removeCaFromStore is only supported on Windows");
    return;
  }

  try {
    runElevatedCaRemoval();
    logger.info("Root CA removed from Windows Trusted Root store");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to remove Root CA from store (best-effort)", {
      error: errorMessage,
    });
  }
}

// ---------------------------------------------------------------------------
// Elevation Internals (VBS + UAC pattern, same as hosts.ts)
// ---------------------------------------------------------------------------

/**
 * Build a VBScript that triggers UAC elevation via Shell.Application.ShellExecute.
 *
 * Duplicated from hosts.ts per SRP: the PS1 content and temp directory naming
 * are specific to CA operations, and the two modules evolve independently.
 */
function buildElevationVbsContent(ps1ScriptPath: string, sentinelPath: string): string {
  const maxIterations = Math.ceil(
    (ELEVATED_COMMAND_TIMEOUT_MS / 1000) * (1000 / SENTINEL_POLL_INTERVAL_MS),
  );
  const escapedSentinelPath = sentinelPath.replace(/\\/g, "\\\\");
  const escapedPs1Path = ps1ScriptPath.replace(/\\/g, "\\\\");

  return [
    'Set shell = CreateObject("Shell.Application")',
    `shell.ShellExecute "powershell.exe", "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""${escapedPs1Path}""", "", "runas", 0`,
    "",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
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

type Ps1Builder = (sentinelPath: string) => string;

/**
 * Run an elevated PS1 script on Windows using VBScript + UAC.
 */
function runElevatedPs1Windows(buildPs1: Ps1Builder): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-ca-"));

  try {
    const sentinelFile = path.join(tempDir, "done.txt");
    const ps1Content = buildPs1(sentinelFile);
    const ps1File = path.join(tempDir, "install-ca.ps1");

    fs.writeFileSync(ps1File, ps1Content, "utf-8");

    const vbsContent = buildElevationVbsContent(ps1File, sentinelFile);
    const vbsFile = path.join(tempDir, "elevate.vbs");
    fs.writeFileSync(vbsFile, vbsContent, "utf-8");

    logger.info("Requesting admin elevation for CA store operation", {
      script: ps1File,
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

    const sentinelContent = fs.readFileSync(sentinelFile, "utf-8").trim();
    if (sentinelContent !== "done") {
      throw new Error(`Elevated script failed: ${sentinelContent}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// PS1 Script Builders
// ---------------------------------------------------------------------------

function buildCaInstallPs1(caCertFilePath: string, sentinelPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$caCertPath = '${caCertFilePath}'`,
    `$sentinelPath = '${sentinelPath}'`,
    "",
    "try {",
    "  Import-Certificate -FilePath $caCertPath -CertStoreLocation Cert:\\LocalMachine\\Root",
    "  Set-Content -Path $sentinelPath -Value 'done'",
    "} catch {",
    '  Set-Content -Path $sentinelPath -Value "ERROR: $($_.Exception.Message)"',
    "  exit 1",
    "}",
  ].join("\r\n");
}

function buildCaRemovalPs1(sentinelPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$sentinelPath = '${sentinelPath}'`,
    "",
    "try {",
    `  $certs = Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -eq 'CN=${CA_COMMON_NAME}' }`,
    "  foreach ($cert in $certs) { Remove-Item $cert.PSPath }",
    "  Set-Content -Path $sentinelPath -Value 'done'",
    "} catch {",
    '  Set-Content -Path $sentinelPath -Value "ERROR: $($_.Exception.Message)"',
    "  exit 1",
    "}",
  ].join("\r\n");
}

// ---------------------------------------------------------------------------
// Elevation Wrappers
// ---------------------------------------------------------------------------

function runElevatedCaInstall(caCertFilePath: string): void {
  runElevatedPs1Windows(
    (sentinelPath) => buildCaInstallPs1(caCertFilePath, sentinelPath),
  );
}

function runElevatedCaRemoval(): void {
  runElevatedPs1Windows(
    (sentinelPath) => buildCaRemovalPs1(sentinelPath),
  );
}
