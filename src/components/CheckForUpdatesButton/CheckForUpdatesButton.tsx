import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
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
    <div className="bg-card border border-border rounded-lg px-5 py-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-base font-semibold text-foreground m-0">Check for updates</h3>
        <button
          type="button"
          className={cn(
            "px-4 py-2 rounded-md bg-success text-white font-medium text-sm",
            "min-w-24 inline-flex items-center justify-center border-none cursor-pointer",
            "disabled:opacity-60 disabled:cursor-progress"
          )}
          onClick={onClick}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? (
            <span
              className="size-4 border-2 border-white/40 border-t-white rounded-full animate-spin motion-reduce:animate-none"
              aria-label="checking"
            />
          ) : (
            "Check now"
          )}
        </button>
      </div>
      <div className="text-[0.8125rem] text-muted-foreground">Last checked: {humanized}</div>
      {message !== "" && (
        <div className="text-sm text-success" role="status">
          {message}
        </div>
      )}
      {skippedVersions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skippedVersions.map((v) => (
            <span
              key={v}
              className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              Skipped: v{v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
