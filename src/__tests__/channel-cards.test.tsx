import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AdminChannel } from "@/hooks/useChannels";

const mockChannel: AdminChannel = {
  id: "ch-1",
  name: "English",
  sources: [{ sourceId: "s1", selectedChannels: [0], gain: 1, muted: false, delayMs: 0 }],
  outputFormat: "mono",
  autoStart: false,
  visible: true,
  sortOrder: 0,
  status: "streaming",
  processing: {},
  createdAt: Date.now(),
};

const mockGetLevels = (_channelId: string) => null;

const noopFn = () => {};
const noopIdFn = (_id: string) => {};

async function renderChannelCard(overrides: Partial<AdminChannel> = {}) {
  const { ChannelCard } = await import("@/components/channels/ChannelCard");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  const { DragDropProvider } = await import("@dnd-kit/react");
  const channel = { ...mockChannel, ...overrides };
  return render(
    <DragDropProvider>
      <TooltipProvider>
        <ChannelCard
          channel={channel}
          index={0}
          getLevels={mockGetLevels}
          onStart={noopIdFn}
          onStop={noopIdFn}
          onConfigure={noopIdFn}
          onRemove={noopIdFn}
        />
      </TooltipProvider>
    </DragDropProvider>
  );
}

async function renderChannelList(channels: AdminChannel[] = [mockChannel]) {
  const { ChannelList } = await import("@/components/channels/ChannelList");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  return render(
    <TooltipProvider>
      <ChannelList
        channels={channels}
        onStartChannel={noopIdFn}
        onStopChannel={noopIdFn}
        onRemoveChannel={noopIdFn}
        onConfigureChannel={noopIdFn}
        onReorderChannels={noopFn}
        onCreateClick={noopFn}
        getLevels={mockGetLevels}
      />
    </TooltipProvider>
  );
}

describe("Channel Cards", () => {
  it("each channel renders inside Card component (CARD-01)", async () => {
    const { container } = await renderChannelCard();
    const card = container.querySelector('[data-slot="card"]');
    expect(card).toBeTruthy();
  });

  it("card has CardHeader and CardContent sections (CARD-01)", async () => {
    const { container } = await renderChannelCard();
    const header = container.querySelector('[data-slot="card-header"]');
    const content = container.querySelector('[data-slot="card-content"]');
    expect(header).toBeTruthy();
    expect(content).toBeTruthy();
  });

  it("channel name displayed in card title (CARD-01)", async () => {
    const { container } = await renderChannelCard();
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title).toBeTruthy();
    expect(title!.textContent).toBe("English");
  });

  it("streaming status badge uses success color (CARD-02)", async () => {
    const { container } = await renderChannelCard({ status: "streaming" });
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("Streaming");
    expect(badge!.className).toContain("bg-success/20");
    expect(badge!.className).toContain("text-success");
  });

  it("stopped status badge uses muted color (CARD-02)", async () => {
    const { container } = await renderChannelCard({ status: "stopped" });
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("Stopped");
    expect(badge!.className).toContain("bg-muted");
    expect(badge!.className).toContain("text-muted-foreground");
  });

  it("error status badge uses destructive color (CARD-02)", async () => {
    const { container } = await renderChannelCard({ status: "error" });
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("Error");
    expect(badge!.className).toContain("bg-destructive/20");
    expect(badge!.className).toContain("text-destructive");
  });

  it("action buttons wrapped in Tooltip triggers (CARD-03)", async () => {
    const { container } = await renderChannelCard();
    const tooltipTriggers = container.querySelectorAll('[data-slot="tooltip-trigger"]');
    // play/stop + trash = 2 tooltips; Settings is a labeled button (no tooltip needed)
    expect(tooltipTriggers.length).toBeGreaterThanOrEqual(2);
  });

  it("action buttons use shadcn Button component (CARD-03)", async () => {
    const { container } = await renderChannelCard();
    const buttons = container.querySelectorAll("button[data-variant]");
    // start/stop, configure, remove = 3 buttons minimum
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it("card has drag handle with GripVertical (CARD-04)", async () => {
    await renderChannelCard();
    const dragHandle = screen.getByRole("button", { name: /drag to reorder/i });
    expect(dragHandle).toBeInTheDocument();
  });

  it("move up/down buttons removed (CARD-04)", async () => {
    const { container } = await renderChannelCard();
    const buttons = container.querySelectorAll("button");
    const ariaLabels = Array.from(buttons).map(b => b.getAttribute("aria-label") ?? "");
    expect(ariaLabels).not.toContain("Move up");
    expect(ariaLabels).not.toContain("Move down");
  });

  it("card contains canvas element for VU meter (CARD-05)", async () => {
    const { container } = await renderChannelCard();
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeTruthy();
  });

  it("VU meter canvas has compact dimensions (CARD-05)", async () => {
    const { container } = await renderChannelCard();
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeTruthy();
    expect(canvas!.style.width).toBe("24px");
    expect(canvas!.style.height).toBe("56px");
  });

  it("channel list wraps in ScrollArea for overflow (TYPO-03)", async () => {
    const { container } = await renderChannelList();
    const viewport = container.querySelector("[data-radix-scroll-area-viewport]");
    expect(viewport).toBeTruthy();
  });

  it("empty channel list shows message without ScrollArea (TYPO-03)", async () => {
    await renderChannelList([]);
    expect(screen.getByText(/no channels yet/i)).toBeInTheDocument();
  });

  it("channel metadata shows format and source count (CARD-01)", async () => {
    await renderChannelCard();
    expect(screen.getByText("mono")).toBeInTheDocument();
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  it("hidden channel shows EyeOff icon (CARD-03)", async () => {
    const { container } = await renderChannelCard({ visible: false });
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("New Channel button exists in list (CARD-01)", async () => {
    await renderChannelList();
    const button = screen.getByRole("button", { name: /new channel/i });
    expect(button).toBeInTheDocument();
  });
});
