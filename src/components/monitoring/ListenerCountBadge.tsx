interface ListenerCountBadgeProps {
  count: number;
  label?: string;
}

export function ListenerCountBadge({
  count,
  label,
}: ListenerCountBadgeProps) {
  const isEmpty = count === 0;
  const className = `listener-badge${isEmpty ? " listener-badge--empty" : ""}`;

  return (
    <span className={className}>
      <svg
        className="listener-badge-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
      <span className="listener-badge-count">{count}</span>
      {label && <span className="listener-badge-label">{label}</span>}
    </span>
  );
}
