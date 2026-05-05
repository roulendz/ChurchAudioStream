import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("Sidebar navigation", () => {
  async function renderSidebar(currentSection = "overview" as const) {
    const { Sidebar } = await import("@/components/layout/Sidebar");
    return render(
      <Sidebar currentSection={currentSection} onNavigate={() => {}} />
    );
  }

  it("renders Lucide icon SVG in each nav item (SIDE-01)", async () => {
    await renderSidebar();
    const nav = screen.getByRole("navigation", { name: /dashboard navigation/i });
    const buttons = nav.querySelectorAll("button");
    expect(buttons.length).toBe(4);
    for (const button of buttons) {
      const svg = button.querySelector("svg");
      expect(svg).toBeTruthy();
    }
  });

  it("active nav item has indicator bar and background highlight (SIDE-02)", async () => {
    await renderSidebar("channels");
    const activeButton = screen.getByRole("button", { name: /channels/i });
    expect(activeButton.className).toContain("border-l-primary");
    expect(activeButton.className).toContain("bg-primary");
    expect(activeButton.getAttribute("aria-current")).toBe("page");
  });

  it("inactive nav items have transparent border (SIDE-02)", async () => {
    await renderSidebar("overview");
    const settingsButton = screen.getByRole("button", { name: /settings/i });
    expect(settingsButton.className).toContain("border-l-transparent");
    expect(settingsButton.getAttribute("aria-current")).toBeNull();
  });

  it("renders separator between nav groups (SIDE-03)", async () => {
    await renderSidebar();
    const separators = screen.getAllByRole("separator");
    expect(separators.length).toBeGreaterThanOrEqual(1);
  });

  it("renders group label headings with uppercase styling (TYPO-02)", async () => {
    await renderSidebar();
    expect(screen.getByText("Main")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    const mainLabel = screen.getByText("Main");
    expect(mainLabel.className).toContain("uppercase");
    expect(mainLabel.className).toContain("tracking-wider");
  });

  it("renders all four nav items with correct labels", async () => {
    await renderSidebar();
    expect(screen.getByRole("button", { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /channels/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /monitoring/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });
});
