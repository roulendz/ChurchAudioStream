import { LayoutDashboard, Radio, Activity, Settings, type LucideIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
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
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Main",
    items: [
      { section: "overview", label: "Overview", icon: LayoutDashboard },
      { section: "channels", label: "Channels", icon: Radio },
    ],
  },
  {
    label: "System",
    items: [
      { section: "monitoring", label: "Monitoring", icon: Activity },
      { section: "settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar({ currentSection, onNavigate }: SidebarProps) {
  return (
    <nav
      className="row-start-2 sticky top-[49px] h-[calc(100vh-49px)] bg-card border-r border-border py-4 overflow-y-auto overflow-x-hidden"
      aria-label="Dashboard navigation"
    >
      {NAV_GROUPS.map((group, groupIndex) => (
        <div key={group.label}>
          {groupIndex > 0 && <Separator decorative={false} className="my-2 mx-3" />}
          <p className="px-5 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {group.label}
          </p>
          {group.items.map(({ section, label, icon: Icon }) => {
            const isActive = section === currentSection;
            return (
              <button
                key={section}
                type="button"
                className={cn(
                  "flex items-center gap-3 w-full px-5 py-2.5",
                  "border-l-[3px] border-l-transparent",
                  "text-muted-foreground text-sm text-left cursor-pointer",
                  "transition-all duration-150",
                  "hover:bg-accent/50 hover:text-foreground",
                  isActive && "border-l-primary text-primary bg-primary/10 font-medium"
                )}
                onClick={() => onNavigate(section)}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="size-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
