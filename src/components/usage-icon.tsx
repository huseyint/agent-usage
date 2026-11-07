import type { CSSProperties } from "react";
import claudeIcon from "@/assets/providers/claude.svg";
import codexIcon from "@/assets/providers/codex.svg";
export type UsageIconName =
  | "overview"
  | "sessions"
  | "projects"
  | "reports"
  | "models"
  | "settings"
  | "refresh"
  | "arrow"
  | "download"
  | "clock"
  | "check"
  | "shield"
  | "chevron"
  | "chevron-down"
  | "search"
  | "filter"
  | "close"
  | "star"
  | "copy"
  | "folder"
  | "external"
  | "sort"
  | "sort-ascending"
  | "sort-descending"
  | "columns"
  | "calendar"
  | "terminal"
  | "activity"
  | "info"
  | "sun"
  | "moon"
  | "sidebar-collapse"
  | "sidebar-expand"
  | "window-minimize"
  | "window-maximize"
  | "window-restore";
const paths: Record<UsageIconName, React.ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  sessions: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m7 9 3 3-3 3m6 0h4" />
    </>
  ),
  projects: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z" />
    </>
  ),
  reports: (
    <>
      <path d="M7 3h8l4 4v14H5V3Zm7 0v5h5M9 12h6m-6 4h6" />
    </>
  ),
  models: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  settings: (
    <>
      <path d="m10 3-1 3-3 1-3 3 2 3v4l4 1 2 3 4-1 1-3 4-2-1-4 1-3-4-2-2-3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 8a8 8 0 1 0 0 8M20 3v6h-6" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  "chevron-down": <path d="m5 9 7 7 7-7" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  filter: (
    <>
      <path d="M3 6h18M6 12h12m-8 6h4" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  star: <path d="m12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1Z" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7m-1-6L10 14M10 3H3v18h18v-7" />
    </>
  ),
  sort: (
    <>
      <path d="M8 4v16m-4-4 4 4 4-4m4 4V4m-4 4 4-4 4 4" />
    </>
  ),
  "sort-ascending": <path d="M5 20V4m-3 3 3-3 3 3m3-1h3m-3 6h6m-6 6h9" />,
  "sort-descending": <path d="M5 4v16m-3-3 3 3 3-3m3-11h9m-9 6h6m-6 6h3" />,
  columns: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16m6-16v16" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18" />
    </>
  ),
  terminal: (
    <>
      <path d="m5 6 6 6-6 6m8 0h6" />
    </>
  ),
  activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
  "sidebar-collapse": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16m7-11-3 3 3 3" />
    </>
  ),
  "sidebar-expand": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16m4-11 3 3-3 3" />
    </>
  ),
  "window-minimize": <path d="M5 12h14" />,
  "window-maximize": <rect x="5" y="5" width="14" height="14" />,
  "window-restore": (
    <>
      <path d="M9 8V4h11v11h-4" />
      <rect x="4" y="9" width="11" height="11" />
    </>
  ),
};
export function UIcon({
  name,
  size = 18,
  style,
  className = "",
}: {
  name: UsageIconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
export function ProviderMark({
  provider,
  label = false,
}: {
  provider: string;
  label?: boolean;
}) {
  return (
    <span className={`provider-mark ${provider}`}>
      <span aria-hidden="true" className="provider-symbol">
        {provider === "claude" ? (
          <img src={claudeIcon} alt="" draggable={false} />
        ) : (
          <img src={codexIcon} alt="" draggable={false} />
        )}
      </span>
      {label && <span>{provider === "claude" ? "Claude Code" : "Codex"}</span>}
    </span>
  );
}
