/**
 * Append-only persistent log writer with per-session filenames.
 *
 * Writes each line to `<directory>/<YYYY-MM-DD_HH-MM-SS>.log`. Filename is
 * computed once at construction (process start), so an entire sidecar run
 * lands in a single file. A separate file is created for each restart.
 *
 * Fail policy:
 *   - Constructor: throws on `mkdir` failure (fail-fast — boot misconfiguration
 *     should be loud).
 *   - Per-write: silenced after the first stderr warning (a transient disk
 *     hiccup must not crash the host process).
 */
import fs from "node:fs";
import path from "node:path";

export class FileLogWriter {
  private readonly filePath: string;
  private readonly stream: fs.WriteStream;
  private writeFailureLogged = false;

  constructor(directory: string, sessionStart: Date = new Date()) {
    fs.mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, `${formatSessionFilename(sessionStart)}.log`);
    this.stream = fs.createWriteStream(this.filePath, { flags: "a", encoding: "utf-8" });
    this.stream.on("error", (err) => this.recordFailure(`stream error: ${err.message}`));
  }

  append(line: string): void {
    try {
      this.stream.write(line + "\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.recordFailure(`write failed: ${message}`);
    }
  }

  getPath(): string {
    return this.filePath;
  }

  close(): void {
    this.stream.end();
  }

  private recordFailure(reason: string): void {
    if (this.writeFailureLogged) return;
    this.writeFailureLogged = true;
    process.stderr.write(`FileLogWriter ${this.filePath} ${reason}\n`);
  }
}

function formatSessionFilename(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${datePart}_${timePart}`;
}
