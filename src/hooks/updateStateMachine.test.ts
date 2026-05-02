import { describe, it, expect } from "vitest";
import { updateReducer, type UpdateUiState } from "./updateStateMachine";

const IDLE: UpdateUiState = { kind: "Idle" };
const AVAILABLE: UpdateUiState = {
  kind: "UpdateAvailable",
  version: "0.2.0",
  notes: "x",
  downloadUrl: "u",
};
const DOWNLOADING: UpdateUiState = {
  kind: "Downloading",
  version: "0.2.0",
  downloadedBytes: 1000,
  totalBytes: 5000,
};
const INSTALLING: UpdateUiState = { kind: "Installing", version: "0.2.0" };
const UPTODATE: UpdateUiState = { kind: "UpToDate", checkedAtUnix: 1700 };
const SILENTSKIP: UpdateUiState = { kind: "SilentSkip", skippedVersion: "0.1.5" };

describe("updateReducer", () => {
  it("Idle + available → UpdateAvailable", () => {
    const next = updateReducer(IDLE, { type: "available", version: "0.2.0", notes: "n", downloadUrl: "u" });
    expect(next).toEqual({ kind: "UpdateAvailable", version: "0.2.0", notes: "n", downloadUrl: "u" });
  });
  it("any + available → UpdateAvailable (overwrites)", () => {
    const next = updateReducer(DOWNLOADING, { type: "available", version: "0.3.0", notes: "n", downloadUrl: "u" });
    expect(next).toEqual({ kind: "UpdateAvailable", version: "0.3.0", notes: "n", downloadUrl: "u" });
  });
  it("Idle + progress → unchanged (guard)", () => {
    const next = updateReducer(IDLE, { type: "progress", downloadedBytes: 100, totalBytes: 1000 });
    expect(next).toBe(IDLE);
  });
  it("Installing + progress → unchanged (guard)", () => {
    const next = updateReducer(INSTALLING, { type: "progress", downloadedBytes: 100, totalBytes: 1000 });
    expect(next).toBe(INSTALLING);
  });
  it("UpdateAvailable + progress → Downloading (preserves version)", () => {
    const next = updateReducer(AVAILABLE, { type: "progress", downloadedBytes: 100, totalBytes: 1000 });
    expect(next).toEqual({ kind: "Downloading", version: "0.2.0", downloadedBytes: 100, totalBytes: 1000 });
  });
  it("Downloading + progress → Downloading (updates bytes)", () => {
    const next = updateReducer(DOWNLOADING, { type: "progress", downloadedBytes: 2000, totalBytes: 5000 });
    expect(next).toEqual({ kind: "Downloading", version: "0.2.0", downloadedBytes: 2000, totalBytes: 5000 });
  });
  it("any + installed → Installing", () => {
    const next = updateReducer(DOWNLOADING, { type: "installed", version: "0.2.0" });
    expect(next).toEqual({ kind: "Installing", version: "0.2.0" });
  });
  it("Idle + installed → Installing (any-state coverage)", () => {
    const next = updateReducer(IDLE, { type: "installed", version: "0.2.0" });
    expect(next).toEqual({ kind: "Installing", version: "0.2.0" });
  });
  it("checkCompleted on UpdateAvailable → unchanged (reducer-local guard)", () => {
    const next = updateReducer(AVAILABLE, { type: "checkCompleted", lastCheckUnix: 1700 });
    expect(next).toBe(AVAILABLE);
  });
  it("checkCompleted on Downloading → unchanged (reducer-local guard)", () => {
    const next = updateReducer(DOWNLOADING, { type: "checkCompleted", lastCheckUnix: 1700 });
    expect(next).toBe(DOWNLOADING);
  });
  it("checkCompleted on Installing → unchanged (reducer-local guard)", () => {
    const next = updateReducer(INSTALLING, { type: "checkCompleted", lastCheckUnix: 1700 });
    expect(next).toBe(INSTALLING);
  });
  it("checkCompleted on Idle → UpToDate", () => {
    const next = updateReducer(IDLE, { type: "checkCompleted", lastCheckUnix: 1700000000 });
    expect(next).toEqual({ kind: "UpToDate", checkedAtUnix: 1700000000 });
  });
  it("checkCompleted on UpToDate → UpToDate (refresh timestamp)", () => {
    const next = updateReducer(UPTODATE, { type: "checkCompleted", lastCheckUnix: 1800 });
    expect(next).toEqual({ kind: "UpToDate", checkedAtUnix: 1800 });
  });
  it("checkCompleted on SilentSkip → UpToDate (skip cleared by fresh check)", () => {
    const next = updateReducer(SILENTSKIP, { type: "checkCompleted", lastCheckUnix: 1800 });
    expect(next).toEqual({ kind: "UpToDate", checkedAtUnix: 1800 });
  });
  it("any + dismissed → Idle", () => {
    expect(updateReducer(AVAILABLE, { type: "dismissed" })).toEqual({ kind: "Idle" });
    expect(updateReducer(DOWNLOADING, { type: "dismissed" })).toEqual({ kind: "Idle" });
    expect(updateReducer(INSTALLING, { type: "dismissed" })).toEqual({ kind: "Idle" });
  });
  it("any + skipped → SilentSkip", () => {
    const next = updateReducer(AVAILABLE, { type: "skipped", version: "0.2.0" });
    expect(next).toEqual({ kind: "SilentSkip", skippedVersion: "0.2.0" });
  });
  it("any + reset → Idle", () => {
    expect(updateReducer(DOWNLOADING, { type: "reset" })).toEqual({ kind: "Idle" });
    expect(updateReducer(UPTODATE, { type: "reset" })).toEqual({ kind: "Idle" });
    expect(updateReducer(SILENTSKIP, { type: "reset" })).toEqual({ kind: "Idle" });
  });
});
