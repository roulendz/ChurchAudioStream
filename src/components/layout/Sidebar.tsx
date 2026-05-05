import { cn } from "@/lib/utils";

/** Dashboard section identifiers for state-driven navigation. */
export type DashboardSection = "overview" | "channels" | "monitoring" | "settings";

interface SidebarProps {
  currentSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
}

interface NavItem {
  section: DashboardSection;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { section: "overview", label: "Overview" },
  { section: "channels", label: "Channels" },
  { section: "monitoring", label: "Monitoring" },
  { section: "settings", label: "Settings" },
];

export function Sidebar({ currentSection, onNavigate }: SidebarProps) {
  return (
    <nav className="row-start-2 bg-card border-r border-border py-4 overflow-y-auto" aria-label="Dashboard navigation">
      {NAV_ITEMS.map(({ section, label }) => {
        const isActive = section === currentSection;
        return (
          <button
            key={section}
            type="button"
            className={cn(
              "flex items-center gap-3 w-full px-5 py-2.5 border-l-[3px] border-l-transparent",
              "text-muted-foreground text-sm text-left cursor-pointer transition-all duration-150",
              "hover:bg-white/[0.04] hover:text-foreground",
              "bg-transparent border-0 font-[inherit]",
              isActive && "border-l-primary text-primary bg-primary/[0.08]"
            )}
            onClick={() => onNavigate(section)}
            aria-current={isActive ? "page" : undefined}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
