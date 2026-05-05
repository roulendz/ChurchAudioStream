import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AdminChannel } from "@/hooks/useChannels";

const mockChannels: AdminChannel[] = [
  {
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
  },
  {
    id: "ch-2",
    name: "Spanish",
    sources: [{ sourceId: "s2", selectedChannels: [0], gain: 1, muted: false, delayMs: 0 }],
    outputFormat: "mono",
    autoStart: false,
    visible: true,
    sortOrder: 1,
    status: "stopped",
    processing: {},
    createdAt: Date.now(),
  },
  {
    id: "ch-3",
    name: "Latvian",
    sources: [{ sourceId: "s3", selectedChannels: [0], gain: 1, muted: false, delayMs: 0 }],
    outputFormat: "mono",
    autoStart: false,
    visible: true,
    sortOrder: 2,
    status: "stopped",
    processing: {},
    createdAt: Date.now(),
  },
];

const mockGetLevels = (_channelId: string) => null;
const noopFn = () => {};
const noopIdFn = (_id: string) => {};

async function renderChannelList(
  channels: AdminChannel[] = mockChannels,
  onReorder = vi.fn(),
) {
  const { ChannelList } = await import("@/components/channels/ChannelList");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  const result = render(
    <TooltipProvider>
      <ChannelList
        channels={channels}
        onStartChannel={noopIdFn}
        onStopChannel={noopIdFn}
        onRemoveChannel={noopIdFn}
        onConfigureChannel={noopIdFn}
        onReorderChannels={onReorder}
        onCreateClick={noopFn}
        getLevels={mockGetLevels}
      />
    </TooltipProvider>
  );
  return { ...result, onReorder };
}

describe("Drag-to-Reorder", () => {
  it("each card has a drag handle (CARD-04a)", async () => {
    await renderChannelList();
    const dragHandles = screen.getAllByRole("button", { name: /drag to reorder/i });
    expect(dragHandles).toHaveLength(mockChannels.length);
  });

  it("drag handles have GripVertical icon (CARD-04a)", async () => {
    const { container } = await renderChannelList();
    const dragHandles = container.querySelectorAll('[aria-label="Drag to reorder"]');
    expect(dragHandles).toHaveLength(mockChannels.length);
    dragHandles.forEach((handle) => {
      const svg = handle.querySelector("svg");
      expect(svg).toBeTruthy();
    });
  });

  it("drag handles have correct cursor classes (CARD-04a)", async () => {
    const { container } = await renderChannelList();
    const dragHandle = container.querySelector('[aria-label="Drag to reorder"]');
    expect(dragHandle).toBeTruthy();
    expect(dragHandle!.className).toContain("cursor-grab");
    expect(dragHandle!.className).toContain("touch-none");
  });

  it("no move up/down buttons in any card (CARD-04b)", async () => {
    const { container } = await renderChannelList();
    const allButtons = container.querySelectorAll("button");
    const ariaLabels = Array.from(allButtons).map(
      (b) => b.getAttribute("aria-label") ?? "",
    );
    expect(ariaLabels).not.toContain("Move up");
    expect(ariaLabels).not.toContain("Move down");
  });

  it("no ChevronUp/ChevronDown icons in cards (CARD-04b)", async () => {
    const { container } = await renderChannelList();
    const tooltipContent = container.textContent ?? "";
    expect(tooltipContent).not.toContain("Move up");
    expect(tooltipContent).not.toContain("Move down");
  });

  it("channel list renders all channels (CARD-04)", async () => {
    const { container } = await renderChannelList();
    const titles = container.querySelectorAll('[data-slot="card-title"]');
    const names = Array.from(titles).map((t) => t.textContent);
    expect(names).toContain("English");
    expect(names).toContain("Spanish");
    expect(names).toContain("Latvian");
  });

  it("single channel still renders drag handle (CARD-04a)", async () => {
    await renderChannelList([mockChannels[0]]);
    const dragHandle = screen.getByRole("button", { name: /drag to reorder/i });
    expect(dragHandle).toBeInTheDocument();
  });
});
