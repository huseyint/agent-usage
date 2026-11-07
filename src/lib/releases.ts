export interface Release {
  version: string;
  date: string;
  items: string[];
}
export const releases: Release[] = [
  {
    version: "0.1.1",
    date: "2026-11-06",
    items: [
      "Import usage even when optional metadata contains oversized records or partial JSON writes.",
      "Continue reading later titles and project metadata with bounded memory; label incomplete session metadata and last-activity date filtering.",
      "Keep the previous snapshot for actual source access failures and engine errors.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-05",
    items: [
      "Named Claude Code and Codex sessions with read-only local source discovery.",
      "Separate daily usage and session lifetime reports, local annotations, and safe CSV/JSON exports.",
      "Pinned native ccusage engine, rebuildable SQLite snapshots, themes, settings, and tray summaries.",
    ],
  },
];
