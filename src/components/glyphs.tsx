// Adapted glyphs under the MIT license. See THIRD_PARTY_NOTICES.md.
import { useId, type CSSProperties, type ReactNode } from "react";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZES: Record<IconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
};

export interface GlyphProps {
  className?: string;
  size?: IconSize | number;
  style?: CSSProperties;
  title?: string;
  "aria-hidden"?: boolean;
}

function resolveSize(size: IconSize | number | undefined, fallback: number) {
  if (size === undefined) {
    return fallback;
  }
  if (typeof size === "number") {
    return size;
  }
  return SIZES[size];
}

interface GlyphSpec {
  grid: number;
  defaultSize: number;
  optical?: (pixels: number) => number;
}

function makeGlyph(render: (id: string) => ReactNode, spec: GlyphSpec) {
  function Glyph(props: GlyphProps) {
    const { className, size, style, title } = props;
    const pixels = resolveSize(size, spec.defaultSize);
    const id = useId();
    const scale = spec.optical ? spec.optical(pixels) : 1;
    const pad = (spec.grid * (1 / scale - 1)) / 2;
    const extent = spec.grid + pad * 2;

    return (
      <svg
        viewBox={`${-pad} ${-pad} ${extent} ${extent}`}
        width={pixels}
        height={pixels}
        fill="currentColor"
        aria-hidden={title ? undefined : true}
        className={className}
        style={style}
      >
        {title ? <title>{title}</title> : null}
        {render(id)}
      </svg>
    );
  }
  return Glyph;
}

/**
 * Soft set: filled shapes with knocked-out details and 2.5px round strokes on a 24px grid.
 * Solid shapes read heavier than line icons at text sizes, so from 14px up they shrink slightly inside their box (96% at 14px, 92% at 16–18px, 90% above).
 * Stroke-only glyphs (arrows, chevrons, check) keep the full box so their strokes do not thin out.
 */
function softOptical(pixels: number) {
  if (pixels <= 13) {
    return 1;
  }
  if (pixels <= 15) {
    return 0.96;
  }
  if (pixels <= 18) {
    return 0.92;
  }
  return 0.9;
}

function softGlyph(render: (id: string) => ReactNode, defaultSize = 16) {
  return makeGlyph(render, { grid: 24, defaultSize, optical: softOptical });
}

function softStroke(render: (id: string) => ReactNode, defaultSize = 16) {
  return makeGlyph(render, { grid: 24, defaultSize });
}

function Knockout(props: { id: string; children: ReactNode }) {
  const { id, children } = props;

  return (
    <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect width="24" height="24" fill="#fff" stroke="none" />
      {children}
    </mask>
  );
}

export const HomeIcon = softGlyph((id) => (
  <>
    <Knockout id={`${id}-m`}>
      <rect x="10" y="14" width="4" height="9" rx="2" fill="#000" />
    </Knockout>
    <path
      mask={`url(#${id}-m)`}
      d="M3.5 10.4c0-.75.33-1.45.9-1.93l5.9-4.95a2.6 2.6 0 0 1 3.4 0l5.9 4.95c.57.48.9 1.18.9 1.93V18a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3z"
    />
  </>
));

export const FilesIcon = softGlyph((id) => (
  <>
    <Knockout id={`${id}-a`}>
      <rect x="2" y="5" width="16" height="18" rx="4.5" fill="#000" />
    </Knockout>
    <rect
      mask={`url(#${id}-a)`}
      x="7.5"
      y="2.5"
      width="13"
      height="15.5"
      rx="3.5"
    />
    <Knockout id={`${id}-b`}>
      <path
        d="M7.5 11.5h5M7.5 15.25h3"
        fill="none"
        stroke="#000"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Knockout>
    <rect mask={`url(#${id}-b)`} x="4" y="7" width="12" height="14.5" rx="3" />
  </>
));

export const SidebarIcon = softGlyph((id) => (
  <>
    <Knockout id={`${id}-m`}>
      <rect x="10.5" y="6.25" width="8.75" height="11.5" rx="2" fill="#000" />
    </Knockout>
    <rect mask={`url(#${id}-m)`} x="2.5" y="4" width="19" height="16" rx="4" />
  </>
));

export const SettingsIcon = softGlyph((id) => (
  <>
    <Knockout id={`${id}-m`}>
      <circle cx="12" cy="12" r="3.1" fill="#000" />
    </Knockout>
    <path
      mask={`url(#${id}-m)`}
      d="M10.08 4.85L10.55 2.81L13.45 2.81L13.92 4.85A7.4 7.4 0 0 1 15.7 5.59L15.7 5.59L17.47 4.48L19.52 6.53L18.41 8.3A7.4 7.4 0 0 1 19.15 10.08L19.15 10.08L21.19 10.55L21.19 13.45L19.15 13.92A7.4 7.4 0 0 1 18.41 15.7L18.41 15.7L19.52 17.47L17.47 19.52L15.7 18.41A7.4 7.4 0 0 1 13.92 19.15L13.92 19.15L13.45 21.19L10.55 21.19L10.08 19.15A7.4 7.4 0 0 1 8.3 18.41L8.3 18.41L6.53 19.52L4.48 17.47L5.59 15.7A7.4 7.4 0 0 1 4.85 13.92L4.85 13.92L2.81 13.45L2.81 10.55L4.85 10.08A7.4 7.4 0 0 1 5.59 8.3L5.59 8.3L4.48 6.53L6.53 4.48L8.3 5.59A7.4 7.4 0 0 1 10.08 4.85z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </>
));

export const SearchIcon = softStroke(() => (
  <>
    <circle
      cx="10.5"
      cy="10.5"
      r="6.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
    />
    <path
      d="M15.6 15.6l4.15 4.15"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
));

export const KeyboardIcon = softGlyph((id) => (
  <>
    <Knockout id={`${id}-m`}>
      <path
        d="M6.75 9.25h.01M10.25 9.25h.01M13.75 9.25h.01M17.25 9.25h.01M8 14.5h8"
        fill="none"
        stroke="#000"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Knockout>
    <rect
      mask={`url(#${id}-m)`}
      x="2"
      y="4.5"
      width="20"
      height="15"
      rx="3.5"
    />
  </>
));

export const BookIcon = softGlyph(() => (
  <>
    <path d="M2.5 5.6c0-.88.74-1.58 1.62-1.52 2.85.2 5.25.98 7.13 2.3V20.4c-1.9-1.22-4.3-1.92-7.18-2.08A1.6 1.6 0 0 1 2.5 16.73z" />
    <path d="M21.5 5.6c0-.88-.74-1.58-1.62-1.52-2.85.2-5.25.98-7.13 2.3V20.4c1.9-1.22 4.3-1.92 7.18-2.08a1.6 1.6 0 0 0 1.57-1.6z" />
  </>
));

export const ExternalLinkIcon = softGlyph((id) => (
  <>
    <Knockout id={`${id}-m`}>
      <path
        d="M20.5 3.5l-8.5 8.5"
        fill="none"
        stroke="#000"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="12" y="0" width="12" height="11.5" rx="3.5" fill="#000" />
    </Knockout>
    <rect mask={`url(#${id}-m)`} x="3" y="5" width="16" height="16" rx="3.75" />
    <path
      d="M14 3.5h6.5V10M20.5 3.5 12.5 11.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
));

export const XIcon = softStroke(() => (
  <path
    d="M6 6l12 12M18 6 6 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const PlusIcon = softStroke(() => (
  <path
    d="M12 4.5v15M4.5 12h15"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const ChevronDownIcon = softStroke(() => (
  <path
    d="M6 9l6 6 6-6"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const ChevronRightIcon = softStroke(() => (
  <path
    d="M9 6l6 6-6 6"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const SunIcon = softGlyph(() => (
  <>
    <circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none" />
    <path
      d="M12 4.1L12 2.7M17.59 6.41L18.58 5.42M19.9 12L21.3 12M17.59 17.59L18.58 18.58M12 19.9L12 21.3M6.41 17.59L5.42 18.58M4.1 12L2.7 12M6.41 6.41L5.42 5.42"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
));

export const MoonIcon = softGlyph(() => (
  <path
    d="M20.2 14.3A8.8 8.8 0 1 1 9.7 3.8a7.2 7.2 0 0 0 10.5 10.5z"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinejoin="round"
  />
));

export const InfoIcon = softGlyph((id) => (
  <>
    <Knockout id={`${id}-m`}>
      <path
        d="M12 11v5.5"
        fill="none"
        stroke="#000"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="7.6" r="1.4" fill="#000" />
    </Knockout>
    <circle mask={`url(#${id}-m)`} cx="12" cy="12" r="9.5" />
  </>
));
