import { useEffect, useState } from "react";
import styles from "./CheckForUpdatesButton.module.css";
import { useUpdateState } from "../../hooks/useUpdateState";
import { formatRelativeTime } from "../../lib/relative-time";

const HUMANIZE_TICK_MS = 60_000;
const RESULT_DISPLAY_MS = 4_000;

type CheckResult = "idle" | "pending" | "uptodate" | "available" | "skipped";

function buildResultMessage(result: CheckResult): string {
  switch (result) {
    case "uptodate": return "Up to date";
    case "available": return "Update available — see banner";
    case "skipped": return "Already skipped — see chip below";
    case "pending": return "";
    case "idle": return "";
  }
}

export function CheckForUpdatesButton() {
  const { state, lastCheckUnix, skippedVersions, checkNow } = useUpdateState();
  const [humanized, setHumanized] = useState<string>(() => formatRelativeTime(lastCheckUnix));
  const [result, setResult] = useState<CheckResult>("idle");

  useEffect(() => {
    setHumanized(formatRelativeTime(lastCheckUnix));
    const interval = setInterval(() => {
      setHumanized(formatRelativeTime(lastCheckUnix));
    }, HUMANIZE_TICK_MS);
    return () => clearInterval(interval);
  }, [lastCheckUnix]);

  async function onClick(): Promise<void> {
    setResult("pending");
    try {
      await checkNow();
    } catch (error) {
      console.warn("CheckForUpdatesButton: check_now failed", error);
      setResult("idle");
      return;
    }
    setResult("idle");
  }

  // Reflect post-check state.kind into inline result for RESULT_DISPLAY_MS.
  useEffect(() => {
    if (result !== "idle") return;
    let nextResult: CheckResult | null = null;
    if (state.kind === "UpToDate") nextResult = "uptodate";
    else if (state.kind === "UpdateAvailable") nextResult = "available";
    else if (state.kind === "SilentSkip") nextResult = "skipped";
    if (nextResult === null) return;
    setResult(nextResult);
    const timer = setTimeout(() => setResult("idle"), RESULT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [state.kind, result]);

  const pending = result === "pending";
  const message = buildResultMessage(result);

  return (
    <div className={styles["card"]}>
      <div className={styles["card-header"]}>
        <h3 className={styles["card-title"]}>Check for updates</h3>
        <button
          type="button"
          className={styles["check-button"]}
          onClick={onClick}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <span className={styles["spinner"]} aria-label="checking" /> : "Check now"}
        </button>
      </div>
      <div className={styles["card-subtext"]}>Last checked: {humanized}</div>
      {message !== "" && (
        <div className={styles["card-result"]} role="status">
          {message}
        </div>
      )}
      {skippedVersions.length > 0 && (
        <div className={styles["chip-row"]}>
          {skippedVersions.map((v) => (
            <span key={v} className={styles["chip"]}>Skipped: v{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}
