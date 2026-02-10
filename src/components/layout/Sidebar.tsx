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
    <nav className="dashboard-sidebar" aria-label="Dashboard navigation">
      {NAV_ITEMS.map(({ section, label }) => {
        const isActive = section === currentSection;
        return (
          <button
            key={section}
            type="button"
            className={`sidebar-nav-item${isActive ? " sidebar-nav-item--active" : ""}`}
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
