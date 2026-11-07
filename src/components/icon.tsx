import type { CSSProperties } from "react";
import {
  BookIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FilesIcon,
  HomeIcon,
  InfoIcon,
  KeyboardIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  SunIcon,
  XIcon,
} from "./glyphs";

const glyphs = {
  workspace: HomeIcon,
  items: FilesIcon,
  guide: BookIcon,
  settings: SettingsIcon,
  sidebar: SidebarIcon,
  search: SearchIcon,
  command: KeyboardIcon,
  sun: SunIcon,
  moon: MoonIcon,
  close: XIcon,
  external: ExternalLinkIcon,
  plus: PlusIcon,
  chevronDown: ChevronDownIcon,
  chevronRight: ChevronRightIcon,
  info: InfoIcon,
};
export type IconName = keyof typeof glyphs | "monitor" | "arrow";

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  if (name !== "monitor" && name !== "arrow") {
    const Glyph = glyphs[name];
    return <Glyph size={size} style={style} />;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {name === "monitor" ? (
        <>
          <rect x="3" y="3.5" width="18" height="13" rx="2.5" />
          <path d="M8 21h8m-4-4.5V21" />
        </>
      ) : (
        <path d="M4.5 12h15m-6-6 6 6-6 6" />
      )}
    </svg>
  );
}
