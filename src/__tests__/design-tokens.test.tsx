import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("design tokens", () => {
  const indexCssPath = resolve(__dirname, "../index.css");
  const indexCss = readFileSync(indexCssPath, "utf-8");

  it("imports tailwindcss", () => {
    expect(indexCss).toContain('@import "tailwindcss"');
  });

  it("defines all required OKLCH token variables", () => {
    const requiredTokens = [
      "--background:", "--foreground:",
      "--primary:", "--primary-foreground:",
      "--secondary:", "--destructive:",
      "--success:", "--warning:",
      "--border:", "--ring:", "--radius:",
      "--card:", "--muted:", "--input:",
      "--accent:", "--accent-foreground:",
    ];
    for (const token of requiredTokens) {
      expect(indexCss).toContain(token);
    }
  });

  it("uses OKLCH color format for all color tokens", () => {
    expect(indexCss).toContain("oklch(");
    const rootBlock = indexCss.match(/:root\s*\{[^}]+\}/s)?.[0] ?? "";
    const hexMatches = rootBlock.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    expect(hexMatches).toEqual([]);
  });

  it("does NOT use .dark selector (dark-only app)", () => {
    expect(indexCss).not.toMatch(/\.dark\s*\{/);
  });

  it("sets system font stack on body (FOUN-05, no CDN fonts)", () => {
    expect(indexCss).toContain("system-ui");
    expect(indexCss).not.toContain("fonts.googleapis.com");
    expect(indexCss).not.toContain("fonts.gstatic.com");
  });

  it("registers custom colors in @theme inline block", () => {
    expect(indexCss).toContain("--color-success: var(--success)");
    expect(indexCss).toContain("--color-warning: var(--warning)");
  });
});

describe("CSS migration completeness", () => {
  it("App.css does not exist (fully migrated)", () => {
    const appCssPath = resolve(__dirname, "../App.css");
    expect(existsSync(appCssPath)).toBe(false);
  });

  it("no CSS module files exist", () => {
    const modulePaths = [
      resolve(__dirname, "../components/CheckForUpdatesButton/CheckForUpdatesButton.module.css"),
      resolve(__dirname, "../components/UpdateToast/UpdateToast.module.css"),
    ];
    for (const p of modulePaths) {
      expect(existsSync(p)).toBe(false);
    }
  });

  it("css-modules.d.ts does not exist", () => {
    const dtsPath = resolve(__dirname, "../css-modules.d.ts");
    expect(existsSync(dtsPath)).toBe(false);
  });
});

describe("component smoke tests (Tailwind classes render)", () => {
  it("DashboardShell renders without crash", async () => {
    const { DashboardShell } = await import("@/components/layout/DashboardShell");
    render(
      <DashboardShell
        currentSection="overview"
        onNavigate={() => {}}
        connectionStatus={"connected" as any}
        reconnectAttempts={0}
      >
        <div>test child</div>
      </DashboardShell>
    );
    expect(screen.getByText("test child")).toBeInTheDocument();
  });

  it("ConnectionStatus renders connected state", async () => {
    const { ConnectionStatus } = await import("@/components/ConnectionStatus");
    render(<ConnectionStatus status={"connected" as any} reconnectAttempts={0} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });
});
