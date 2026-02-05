import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SIDECAR_ROOT = path.dirname(new URL(import.meta.url).pathname).replace(
  /^\//,
  "",
); // Remove leading slash on Windows
const TAURI_BINARIES_DIR = path.resolve(SIDECAR_ROOT, "..", "src-tauri", "binaries");
const DIST_DIR = path.resolve(SIDECAR_ROOT, "dist");
const DIST_ENTRY = path.resolve(DIST_DIR, "index.js");

// Target triple to pkg target mapping
const TARGET_TRIPLE_TO_PKG: Record<string, string> = {
  "x86_64-windows": "node22-win-x64",
  "x86_64-linux": "node22-linux-x64",
  "x86_64-darwin": "node22-macos-x64",
  "aarch64-darwin": "node22-macos-arm64",
  "aarch64-linux": "node22-linux-arm64",
};

function runCommand(label: string, command: string, cwd?: string): void {
  console.log(`[build] ${label}...`);
  console.log(`[build]   $ ${command}`);
  try {
    execSync(command, {
      cwd: cwd ?? SIDECAR_ROOT,
      stdio: "inherit",
      env: { ...process.env },
    });
    console.log(`[build] ${label} -- done`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[build] ${label} -- FAILED: ${message}`);
    process.exit(1);
  }
}

function detectTargetTriple(): string {
  try {
    return execSync("rustc --print host-tuple", { encoding: "utf-8" }).trim();
  } catch {
    const rustcOutput = execSync("rustc -vV", { encoding: "utf-8" });
    const hostLine = rustcOutput
      .split("\n")
      .find((line) => line.startsWith("host:"));
    if (!hostLine) {
      console.error("[build] Could not determine target triple from rustc");
      process.exit(1);
    }
    return hostLine.replace("host:", "").trim();
  }
}

function resolvePkgTarget(targetTriple: string): string {
  for (const [pattern, pkgTarget] of Object.entries(TARGET_TRIPLE_TO_PKG)) {
    const [arch, os] = pattern.split("-");
    if (targetTriple.includes(arch) && targetTriple.includes(os)) {
      return pkgTarget;
    }
  }
  console.error(`[build] Unsupported target triple: ${targetTriple}`);
  process.exit(1);
}

function build(): void {
  console.log("=== ChurchAudioStream Sidecar Build ===\n");

  // Detect platform early (used throughout)
  const targetTriple = detectTargetTriple();
  const isWindows = targetTriple.includes("windows");
  const binaryExtension = isWindows ? ".exe" : "";
  const binaryName = `server-${targetTriple}${binaryExtension}`;
  const pkgTarget = resolvePkgTarget(targetTriple);

  console.log(`[build] Target triple: ${targetTriple}`);
  console.log(`[build] pkg target:    ${pkgTarget}`);
  console.log(`[build] Binary name:   ${binaryName}\n`);

  // Step 1: Clean previous build output
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
    console.log("[build] Cleaned previous dist/");
  }

  // Step 2: Compile TypeScript to CommonJS (required for pkg compatibility)
  runCommand("Compiling TypeScript", "npx tsc --project tsconfig.build.json");

  if (!fs.existsSync(DIST_ENTRY)) {
    console.error(`[build] Expected compiled output at ${DIST_ENTRY} not found`);
    process.exit(1);
  }

  // Step 3: Ensure binaries directory exists
  if (!fs.existsSync(TAURI_BINARIES_DIR)) {
    fs.mkdirSync(TAURI_BINARIES_DIR, { recursive: true });
    console.log(`[build] Created directory: ${TAURI_BINARIES_DIR}`);
  }

  // Step 4: Compile with pkg
  const pkgOutputPath = path.resolve(SIDECAR_ROOT, "server");
  runCommand(
    "Compiling standalone binary with pkg",
    `npx pkg ${DIST_ENTRY} --target ${pkgTarget} --output ${pkgOutputPath}`,
  );

  // Step 5: Find the pkg output (may or may not have .exe)
  const pkgOutputWithExt = `${pkgOutputPath}${binaryExtension}`;
  const actualPkgOutput = fs.existsSync(pkgOutputWithExt)
    ? pkgOutputWithExt
    : pkgOutputPath;

  if (!fs.existsSync(actualPkgOutput)) {
    console.error(`[build] pkg output not found at ${pkgOutputPath} or ${pkgOutputWithExt}`);
    process.exit(1);
  }

  // Step 6: Copy to Tauri binaries directory with target triple name
  const finalBinaryPath = path.resolve(TAURI_BINARIES_DIR, binaryName);
  fs.copyFileSync(actualPkgOutput, finalBinaryPath);
  console.log(`[build] Copied binary to: ${finalBinaryPath}`);

  // Step 7: Clean up temporary pkg output
  fs.unlinkSync(actualPkgOutput);

  // Step 8: Report
  const binarySize = fs.statSync(finalBinaryPath).size;
  const binarySizeMB = (binarySize / (1024 * 1024)).toFixed(1);
  console.log(`\n=== Build Complete ===`);
  console.log(`Binary: ${finalBinaryPath}`);
  console.log(`Size:   ${binarySizeMB} MB`);
  console.log(`Target: ${pkgTarget}`);
}

build();
