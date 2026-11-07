export type Provider = "claude" | "codex";
export interface ProjectIconData {
  src?: string | null;
  darkSrc?: string | null;
  kind: "image" | "gitlab" | "github" | "git" | "folder";
  source: string;
}
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}
export interface ModelUsage {
  model: string;
  tokens: Tokens;
  costMicros: number;
  periodCostMicros?: number | null;
  lifetimeCostMicros?: number | null;
  missingPricing: boolean;
  storedCostMicros?: number | null;
  isFallback: boolean;
}
export interface Session {
  key: string;
  id: string;
  provider: Provider;
  sourceId: string;
  title: string;
  titleProvenance: string;
  nativeTitle?: string | null;
  project: string;
  projectPath: string;
  sourcePath?: string | null;
  firstActivity: string;
  lastActivity: string;
  activityDays: string[];
  tokens: Tokens;
  costMicros: number;
  dailyUsage?: DailyUsage[] | null;
  periodCostMicros?: number | null;
  models: ModelUsage[];
  missingPricing: boolean;
  favorite: boolean;
  tags: string[];
  sourceStatus: string;
}
export interface DailyUsage {
  date: string;
  provider: Provider;
  tokens: Tokens;
  costMicros: number;
  models: ModelUsage[];
  missingPricing: boolean;
}
export interface Source {
  id: string;
  provider: Provider;
  root: string;
  status: string;
  sessionCount: number;
  warning?: string | null;
}
export interface Preferences {
  timezone: string;
  theme: "system" | "light" | "dark";
  weekStart: string;
  defaultRange: string;
  claudeRoots: string[];
  codexRoots: string[];
  enginePath?: string | null;
  costMode: string;
  codexSpeed: string;
  claudeMonthlyAllowanceUsd: number | null;
  codexMonthlyAllowanceUsd: number | null;
  promptFallback: boolean;
  foregroundSeconds: number;
  backgroundSeconds: number;
  trayEnabled: boolean;
  trayTitle: boolean;
  closeToTray: boolean;
  onboarded: boolean;
}
export interface AppError {
  code: string;
  message: string;
}
export interface Bootstrap {
  preferences: Preferences;
  sources: Source[];
  hasSnapshot: boolean;
  scanning: boolean;
  lastError?: AppError | null;
  engineVersion: string;
  trayAvailable: boolean;
}
export interface Query {
  providers: string[];
  since: string | null;
  until: string | null;
  search: string;
  projects: string[];
  models: string[];
  favorite: boolean;
  tag: string;
  provenance: string;
  sourceId: string;
  minCost: number | null;
  maxCost: number | null;
  minTokens: number | null;
  maxTokens: number | null;
  sort: string;
  descending: boolean;
  groupBy: string;
  descendingGroups: boolean;
  weekStart: string;
  offset: number;
  limit: number;
}
export interface Summary {
  tokens: Tokens;
  costMicros: number;
  lifetimeCostMicros: number;
  sessions: number;
  projects: number;
  activeDays: number;
  missingPricing: boolean;
}
export interface ProjectSummary {
  key: string;
  name: string;
  tokens: Tokens;
  costMicros: number;
  periodCostMicros?: number | null;
  sessions: number;
  lastActivity: string;
  claudeMicros: number;
  codexMicros: number;
  topModel: string;
}
export interface ViewData {
  groupTotals: Record<string, [number, number]>;
  groupPeriodTotals: Record<string, number | null>;
  providerLifetimeCosts: Record<string, number>;
  summary: Summary;
  previous: Summary | null;
  sessions: Session[];
  sessionCount: number;
  daily: DailyUsage[];
  projects: ProjectSummary[];
  models: ModelUsage[];
  topSessions: Session[];
  sources: Source[];
  scannedAt: string;
  engineVersion: string;
  timezone: string;
  costMode: string;
  stale: boolean;
  warnings: string[];
  availableProjects: [string, string][];
  availableModels: string[];
}
export interface Annotation {
  title: string | null;
  favorite: boolean;
  tags: string[];
}
export const defaultPreferences: Preferences = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  theme: "system",
  weekStart: "monday",
  defaultRange: "30d",
  claudeRoots: [],
  codexRoots: [],
  enginePath: null,
  costMode: "auto",
  codexSpeed: "auto",
  claudeMonthlyAllowanceUsd: null,
  codexMonthlyAllowanceUsd: null,
  promptFallback: true,
  foregroundSeconds: 60,
  backgroundSeconds: 300,
  trayEnabled: true,
  trayTitle: false,
  closeToTray: true,
  onboarded: false,
};
export const defaultQuery: Query = {
  providers: [],
  since: null,
  until: null,
  search: "",
  projects: [],
  models: [],
  favorite: false,
  tag: "",
  provenance: "",
  sourceId: "",
  minCost: null,
  maxCost: null,
  minTokens: null,
  maxTokens: null,
  sort: "last",
  descending: true,
  groupBy: "day",
  descendingGroups: true,
  weekStart: "monday",
  offset: 0,
  limit: 100,
};
