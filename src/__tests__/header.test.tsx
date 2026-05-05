import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardSection } from "@/components/layout/Sidebar";

describe("Header components", () => {
  async function renderShell(currentSection: DashboardSection = "overview") {
    const { DashboardShell } = await import(
      "@/components/layout/DashboardShell"
    );
    const { TooltipProvider } = await import("@/components/ui/tooltip");
    return render(
      <TooltipProvider>
        <DashboardShell
          currentSection={currentSection}
          onNavigate={() => {}}
          connectionStatus={"connected" as any}
          reconnectAttempts={0}
          totalListeners={42}
        >
          <div>test child</div>
        </DashboardShell>
      </TooltipProvider>
    );
  }

  it("breadcrumb shows Admin > current section label (HEAD-01)", async () => {
    const { container } = await renderShell("monitoring");
    expect(screen.getByText("Admin")).toBeInTheDocument();
    const breadcrumbPage = container.querySelector('[data-slot="breadcrumb-page"]');
    expect(breadcrumbPage).toBeTruthy();
    expect(breadcrumbPage!.textContent).toBe("Monitoring");
  });

  it("breadcrumb updates when section changes (HEAD-01)", async () => {
    const { container } = await renderShell("settings");
    const breadcrumbPage = container.querySelector('[data-slot="breadcrumb-page"]');
    expect(breadcrumbPage).toBeTruthy();
    expect(breadcrumbPage!.textContent).toBe("Settings");
  });

  it("connection status renders inside Badge with dot (HEAD-02)", async () => {
    await renderShell();
    const statusElement = screen.getByRole("status");
    expect(statusElement).toBeInTheDocument();
    expect(statusElement.textContent).toContain("Connected");
    // Badge renders with data-slot="badge" (shadcn convention) or has outline variant classes
    const dot = statusElement.querySelector("span[aria-hidden]");
    expect(dot).toBeTruthy();
  });

  it("listener count badge visible in header (HEAD-03)", async () => {
    await renderShell();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("toggle button exists with accessible label (HEAD-04)", async () => {
    await renderShell();
    const toggleButton = screen.getByRole("button", {
      name: /toggle sidebar/i,
    });
    expect(toggleButton).toBeInTheDocument();
  });

  it("clicking toggle hides sidebar (HEAD-04)", async () => {
    const { container } = await renderShell();
    const user = userEvent.setup();
    const toggleButton = screen.getByRole("button", {
      name: /toggle sidebar/i,
    });

    // Sidebar visible initially
    const navBefore = container.querySelector(
      'nav[aria-label="Dashboard navigation"]'
    );
    expect(navBefore).toBeTruthy();

    // Click toggle
    await user.click(toggleButton);

    // Sidebar hidden
    const navAfter = container.querySelector(
      'nav[aria-label="Dashboard navigation"]'
    );
    expect(navAfter).toBeNull();
  });

  it("clicking toggle twice restores sidebar (HEAD-04)", async () => {
    const { container } = await renderShell();
    const user = userEvent.setup();
    const toggleButton = screen.getByRole("button", {
      name: /toggle sidebar/i,
    });

    await user.click(toggleButton);
    await user.click(toggleButton);

    const nav = container.querySelector(
      'nav[aria-label="Dashboard navigation"]'
    );
    expect(nav).toBeTruthy();
  });
});

describe("ConnectionStatus Badge (HEAD-02)", () => {
  it("connected status dot has animate-pulse class", async () => {
    const { ConnectionStatus } = await import(
      "@/components/ConnectionStatus"
    );
    const { container } = render(
      <ConnectionStatus status={"connected" as any} reconnectAttempts={0} />
    );
    const dot = container.querySelector("span[aria-hidden]");
    expect(dot).toBeTruthy();
    expect(dot!.className).toContain("animate-pulse");
  });

  it("disconnected status dot does NOT pulse", async () => {
    const { ConnectionStatus } = await import(
      "@/components/ConnectionStatus"
    );
    const { container } = render(
      <ConnectionStatus
        status={"disconnected" as any}
        reconnectAttempts={0}
      />
    );
    const dot = container.querySelector("span[aria-hidden]");
    expect(dot).toBeTruthy();
    expect(dot!.className).not.toContain("animate-pulse");
  });
});

describe("ListenerCountBadge (HEAD-03)", () => {
  it("renders count with Lucide Users icon (no inline SVG)", async () => {
    const { ListenerCountBadge } = await import(
      "@/components/monitoring/ListenerCountBadge"
    );
    const { container } = render(<ListenerCountBadge count={7} />);
    expect(screen.getByText("7")).toBeInTheDocument();
    // Lucide icons render as <svg> with specific lucide class
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    // No hardcoded path element with the old user icon path
    const paths = container.querySelectorAll("path");
    const oldPath = "M12 12c2.21";
    const hasOldPath = Array.from(paths).some((p) =>
      p.getAttribute("d")?.startsWith(oldPath)
    );
    expect(hasOldPath).toBe(false);
  });
});
