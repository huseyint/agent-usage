import { appVersion } from "@/lib/version";
import appIcon from "../../assets/app-icon.svg";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { useUsage } from "@/lib/usage-context";
import { usageApi, errorMessage } from "@/lib/usage-api";
import { type Preferences } from "@/lib/usage-types";
import {
  ccusageUrl,
  isDesktop,
  openExternalUrl,
  repositoryUrl,
} from "@/lib/desktop";
import { PageHeading, Panel } from "@/components/usage-components";
import { ProviderMark, UIcon } from "@/components/usage-icon";
import { TimezoneSelect } from "@/components/timezone-select";
import { invoke } from "@tauri-apps/api/core";
import { validMonthlyAllowance } from "@/lib/monthly-allowance";
import { preferenceError } from "@/lib/preference-mutation";
const sections = [
  "General",
  "Sources",
  "Engine & costs",
  "Refresh & tray",
  "Privacy & data",
  "About",
];
function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="usage-setting-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="usage-switch"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function UsageSettings() {
  const u = useUsage();
  const [section, setSection] = useState("General");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Partial<Preferences>>({});
  const draft = { ...u.prefs, ...edits };
  const [engineResult, setEngineResult] = useState("");
  const [testing, setTesting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [diagnostics, setDiagnostics] = useState("");
  function handleExternalLink(event: MouseEvent<HTMLAnchorElement>) {
    if (!isDesktop) return;
    event.preventDefault();
    void openExternalUrl(event.currentTarget.href).catch(() =>
      u.setNotice("Couldn’t open GitHub. Please try again."),
    );
  }
  const set = (changes: Partial<Preferences>) => {
    setEdits((previous) => ({ ...previous, ...changes }));
    if (preferenceError(changes)) return;
    const normalized = { ...changes };
    if (normalized.claudeRoots)
      normalized.claudeRoots = normalized.claudeRoots.filter(Boolean);
    if (normalized.codexRoots)
      normalized.codexRoots = normalized.codexRoots.filter(Boolean);
    void u.savePreferences.mutateAsync(normalized).catch(() => {
      setEdits((previous) => {
        const next = { ...previous };
        for (const key of Object.keys(changes) as (keyof Preferences)[]) {
          if (Object.is(previous[key], changes[key])) delete next[key];
        }
        return next;
      });
    });
  };
  const timezoneError = preferenceError({ timezone: draft.timezone });
  const enginePathError = preferenceError({ enginePath: draft.enginePath });
  const filtered = sections.filter((s) =>
    `${s} ${s === "Engine & costs" ? "monthly allowance budget USD Claude Codex" : s === "About" ? "GitHub repository source code star support ccusage" : ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const current = filtered.includes(section) ? section : filtered[0];
  async function browse(
    kind: string,
    field: "enginePath" | "claudeRoots" | "codexRoots",
  ) {
    if (!isDesktop) {
      u.setNotice("File and folder selection is available in the desktop app.");
      return;
    }
    try {
      const path = await invoke<string | null>("choose_local_path", { kind });
      if (path)
        set({
          [field]: field === "enginePath" ? path : [...draft[field], path],
        });
    } catch (e) {
      u.setNotice(errorMessage(e));
    }
  }
  async function test() {
    setTesting(true);
    try {
      const r = await usageApi.testEngine();
      setEngineResult(`Compatible · ccusage ${r.version} · ${r.source}`);
    } catch (e) {
      setEngineResult(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }
  return (
    <div className="page settings-page">
      <PageHeading title="Settings" />
      <div className="settings-workspace">
        <aside className="settings-sections">
          <label className="settings-search">
            <UIcon name="search" size={14} />
            <input
              placeholder="Find a section…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search settings"
            />
          </label>
          <nav>
            {filtered.map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={current === s ? "active" : ""}
              >
                {s}
              </button>
            ))}
          </nav>
        </aside>
        <div className="settings-content">
          {!current && (
            <p className="no-results">No settings sections match.</p>
          )}
          {current === "General" && (
            <Panel title="General">
              <SettingRow
                title="Appearance"
                description="Follow the system, or choose a theme."
              >
                <div className="segmented">
                  {(["system", "light", "dark"] as const).map((t) => (
                    <button
                      className={draft.theme === t ? "selected" : ""}
                      key={t}
                      onClick={() => set({ theme: t })}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow
                title="Display timezone"
                description="Changes trigger a new event-day aggregation on refresh."
              >
                <TimezoneSelect
                  aria-invalid={!!timezoneError}
                  aria-describedby={
                    timezoneError ? "timezone-error" : undefined
                  }
                  value={draft.timezone}
                  onChange={(timezone) => set({ timezone })}
                />
                {timezoneError && (
                  <p id="timezone-error" role="alert">
                    {timezoneError}
                  </p>
                )}
              </SettingRow>
              <SettingRow
                title="First day of week"
                description="Applies to weekly reports."
              >
                <select
                  aria-label="First day of week"
                  value={draft.weekStart}
                  onChange={(e) => set({ weekStart: e.target.value })}
                >
                  <option value="monday">Monday</option>
                  <option value="sunday">Sunday</option>
                </select>
              </SettingRow>
              <SettingRow
                title="Default date range"
                description="Used when opening the workspace."
              >
                <select
                  aria-label="Default date range"
                  value={draft.defaultRange}
                  onChange={(e) => set({ defaultRange: e.target.value })}
                >
                  <option value="today">Today</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="month">This month</option>
                  <option value="all">All time</option>
                </select>
              </SettingRow>
            </Panel>
          )}
          {current === "Sources" && (
            <>
              <Panel
                title="Local sources"
                subtitle="Read-only access to usage logs. No authentication files are opened."
              >
                <div className="source-health-list">
                  {(u.bootstrap.data?.sources || []).map((s) => (
                    <div key={s.id}>
                      <ProviderMark provider={s.provider} label />
                      <code title={s.root}>
                        {s.root.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~")}
                      </code>
                      <span
                        className={`subtle-badge ${s.status === "ready" ? "success" : ""}`}
                      >
                        {s.status === "ready" ? "Readable" : s.status}
                      </span>
                    </div>
                  ))}
                </div>
                {(["claude", "codex"] as const).map((provider) => {
                  const field =
                    provider === "claude" ? "claudeRoots" : "codexRoots";
                  const error = preferenceError({ [field]: draft[field] });
                  return (
                    <div className="source-root-setting" key={provider}>
                      <label>
                        <strong>
                          {provider === "claude" ? "Claude Code" : "Codex"}{" "}
                          roots
                        </strong>
                        <small>
                          One absolute config/home directory per line. Empty
                          uses environment variables and standard paths.
                        </small>
                        <textarea
                          rows={3}
                          aria-label={`${provider} source roots`}
                          aria-invalid={!!error}
                          aria-describedby={
                            error ? `${provider}-roots-error` : undefined
                          }
                          placeholder={
                            provider === "claude"
                              ? "Auto-detect ~/.claude and ~/.config/claude"
                              : "Auto-detect CODEX_HOME or ~/.codex"
                          }
                          value={draft[field].join("\n")}
                          onChange={(e) =>
                            set({ [field]: e.target.value.split("\n") })
                          }
                        />
                        {error && (
                          <p id={`${provider}-roots-error`} role="alert">
                            {error}
                          </p>
                        )}
                      </label>
                      <button
                        className="secondary-button"
                        onClick={() => void browse("folder", field)}
                      >
                        <UIcon name="folder" size={14} />
                        Add folder
                      </button>
                    </div>
                  );
                })}
              </Panel>
              <div className="coverage-banner">
                <UIcon name="info" size={16} />
                <span>
                  Canonical duplicate and nested roots are collapsed. Deleted
                  logs disappear from totals after a complete rescan. Cached
                  snapshots are rebuildable, not a permanent archive.
                </span>
              </div>
            </>
          )}
          {current === "Engine & costs" && (
            <>
              <Panel
                title="Monthly allowances"
                subtitle="Optional USD allowances for each provider. Track this month’s estimated spend in the sidebar. Leave blank to hide an indicator."
              >
                {(["claude", "codex"] as const).map((provider) => {
                  const field =
                    provider === "claude"
                      ? "claudeMonthlyAllowanceUsd"
                      : "codexMonthlyAllowanceUsd";
                  const label = provider === "claude" ? "Claude Code" : "Codex";
                  const valid = validMonthlyAllowance(draft[field]);
                  return (
                    <SettingRow
                      key={provider}
                      title={label}
                      description="Monthly allowance in USD. Resets on the first of each month in your display timezone."
                    >
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        aria-label={`${label} monthly allowance (USD)`}
                        aria-invalid={!valid}
                        aria-describedby={
                          !valid ? `${provider}-allowance-error` : undefined
                        }
                        placeholder="No allowance"
                        value={
                          Number.isNaN(draft[field]) ? "" : (draft[field] ?? "")
                        }
                        onChange={(e) =>
                          set({
                            [field]:
                              e.target.value === "" &&
                              !e.target.validity.badInput
                                ? null
                                : e.target.valueAsNumber,
                          })
                        }
                      />
                      {!valid && (
                        <p id={`${provider}-allowance-error`} role="alert">
                          Enter a positive USD amount or leave blank.
                        </p>
                      )}
                    </SettingRow>
                  );
                })}
              </Panel>
              <Panel
                title="Usage engine"
                subtitle="Pinned ccusage 20.0.48 · standalone native executable"
              >
                <SettingRow
                  title="Engine source"
                  description="External engines must match the verified version."
                >
                  <select
                    aria-label="Engine source"
                    value={
                      draft.enginePath === null ||
                      draft.enginePath === undefined
                        ? "bundled"
                        : "external"
                    }
                    onChange={(e) =>
                      set({
                        enginePath: e.target.value === "bundled" ? null : "",
                      })
                    }
                  >
                    <option value="bundled">Bundled (recommended)</option>
                    <option value="external">Existing executable</option>
                  </select>
                </SettingRow>
                {draft.enginePath !== null &&
                  draft.enginePath !== undefined && (
                    <div className="engine-path">
                      <label>
                        Absolute executable path
                        <input
                          aria-label="External engine path"
                          aria-invalid={!!enginePathError}
                          aria-describedby={
                            enginePathError ? "engine-path-error" : undefined
                          }
                          value={draft.enginePath}
                          onChange={(e) => set({ enginePath: e.target.value })}
                          placeholder="/absolute/path/to/ccusage"
                        />
                        {enginePathError && (
                          <p id="engine-path-error" role="alert">
                            {enginePathError}
                          </p>
                        )}
                      </label>
                      <button
                        className="secondary-button"
                        onClick={() => void browse("file", "enginePath")}
                      >
                        Choose executable
                      </button>
                    </div>
                  )}
                <SettingRow
                  title="Compatibility check"
                  description="Test the current engine selection."
                >
                  <button
                    className="secondary-button"
                    onClick={() => void test()}
                    disabled={
                      testing ||
                      u.savePreferences.isPending ||
                      !!enginePathError
                    }
                  >
                    {testing ? "Testing…" : "Test engine"}
                  </button>
                </SettingRow>
                {engineResult && (
                  <p className="engine-result" role="status">
                    {engineResult}
                  </p>
                )}
              </Panel>
              <Panel
                title="Cost calculation"
                subtitle="API-equivalent estimates, never subscription charges."
              >
                <SettingRow
                  title="Calculation mode"
                  description="Auto uses recorded costs when available, otherwise token pricing."
                >
                  <select
                    aria-label="Cost calculation mode"
                    value={draft.costMode}
                    onChange={(e) => set({ costMode: e.target.value })}
                  >
                    <option value="auto">Auto</option>
                    <option value="calculate">Calculate from tokens</option>
                    <option value="display">Recorded cost only</option>
                  </select>
                </SettingRow>
                <SettingRow
                  title="Codex speed pricing"
                  description="Uses ccusage’s service-tier pricing policy."
                >
                  <select
                    aria-label="Codex speed pricing"
                    value={draft.codexSpeed}
                    onChange={(e) => set({ codexSpeed: e.target.value })}
                  >
                    {["auto", "standard", "flex", "fast"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </SettingRow>
                <div className="coverage-banner">
                  <UIcon name="shield" size={16} />
                  <span>
                    Offline pricing is always enabled. A pricing snapshot is
                    embedded in the pinned engine. No pricing downloads happen
                    at app launch or refresh.
                  </span>
                </div>
              </Panel>
            </>
          )}
          {current === "Refresh & tray" && (
            <Panel title="Refresh & tray">
              <SettingRow
                title="Foreground refresh"
                description="Minimum 30 seconds. File changes also trigger a debounced scan."
              >
                <select
                  value={draft.foregroundSeconds}
                  onChange={(e) =>
                    set({ foregroundSeconds: Number(e.target.value) })
                  }
                  aria-label="Foreground refresh interval"
                >
                  <option value="30">30 seconds</option>
                  <option value="60">1 minute</option>
                  <option value="300">5 minutes</option>
                  <option value="900">15 minutes</option>
                </select>
              </SettingRow>
              <SettingRow
                title="Background refresh"
                description="Used while the window is hidden or inactive."
              >
                <select
                  value={draft.backgroundSeconds}
                  onChange={(e) =>
                    set({ backgroundSeconds: Number(e.target.value) })
                  }
                  aria-label="Background refresh interval"
                >
                  <option value="0">Off</option>
                  <option value="60">1 minute</option>
                  <option value="300">5 minutes</option>
                  <option value="900">15 minutes</option>
                </select>
              </SettingRow>
              <SettingRow
                title="Menu bar / system tray"
                description={`Today’s estimated value, provider split, refresh, and quit. ${u.bootstrap.data?.trayAvailable ? "Native tray is available." : "Native tray is unavailable in this session; closing exits."}`}
              >
                <Toggle
                  label="Enable system tray"
                  checked={draft.trayEnabled}
                  onChange={(v) => set({ trayEnabled: v })}
                />
              </SettingRow>
              <SettingRow
                title="Cost in macOS menu bar"
                description="On Windows and Linux, cost appears in the tray menu and tooltip."
              >
                <Toggle
                  label="Show cost in menu bar"
                  checked={draft.trayTitle}
                  onChange={(v) => set({ trayTitle: v })}
                />
              </SettingRow>
              <SettingRow
                title="When closing the window"
                description="Use Quit in the app or tray menu to exit. If no tray is available, closing exits."
              >
                <select
                  aria-label="Close behavior"
                  value={draft.closeToTray ? "hide" : "quit"}
                  onChange={(e) =>
                    set({ closeToTray: e.target.value === "hide" })
                  }
                >
                  <option value="hide">Hide to tray</option>
                  <option value="quit">Quit</option>
                </select>
              </SettingRow>
            </Panel>
          )}
          {current === "Privacy & data" && (
            <>
              <Panel title="Privacy & data">
                <SettingRow
                  title="Prompt fallback for titles"
                  description="Use a sanitized, bounded first user message when no native title exists. Titles can still contain sensitive information. Turning this off purges derived prompt titles immediately."
                >
                  <Toggle
                    label="Use prompt title fallback"
                    checked={draft.promptFallback}
                    onChange={(v) => set({ promptFallback: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Rebuildable usage cache"
                  description="Clearing cached reports preserves your local titles, favorites, tags, and project aliases."
                >
                  <button
                    className="secondary-button danger"
                    onClick={() => setConfirmClear(true)}
                  >
                    Clear cache
                  </button>
                </SettingRow>
                {confirmClear && (
                  <div className="confirmation-row">
                    <p>
                      Remove the current cached usage snapshot? Local
                      annotations will be kept.
                    </p>
                    <div className="button-row">
                      <button
                        className="primary-button"
                        onClick={() =>
                          void usageApi
                            .clear()
                            .then(async () => {
                              setConfirmClear(false);
                              await u.invalidate();
                              u.setNotice(
                                "Cached usage cleared. Refresh to rebuild.",
                              );
                            })
                            .catch((e) => u.setNotice(errorMessage(e)))
                        }
                      >
                        Clear cached usage
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => setConfirmClear(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <SettingRow
                  title="Application data"
                  description="Open the folder containing the app’s SQLite database."
                >
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void usageApi
                        .open("data")
                        .catch((e) => u.setNotice(errorMessage(e)))
                    }
                  >
                    <UIcon name="folder" size={14} />
                    Open data folder
                  </button>
                </SettingRow>
                <SettingRow
                  title="Safe diagnostics"
                  description="Only versions, platform, counts, and stable error codes. No titles, IDs, prompts, or source paths."
                >
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void usageApi
                        .diagnostics()
                        .then((d) => setDiagnostics(JSON.stringify(d, null, 2)))
                        .catch((e) => u.setNotice(errorMessage(e)))
                    }
                  >
                    Show diagnostics
                  </button>
                </SettingRow>
                {diagnostics && (
                  <pre className="diagnostics-output">{diagnostics}</pre>
                )}
              </Panel>
              <div className="privacy-promise">
                <UIcon name="shield" size={22} />
                <div>
                  <strong>No accounts. No telemetry. No uploads.</strong>
                  <p>
                    Provider files are read-only. No transcript viewer or
                    transcript search is included. Exports include only the
                    chosen report fields.
                  </p>
                </div>
              </div>
            </>
          )}
          {current === "About" && (
            <Panel title="AI Coding Usage">
              <div className="about-app">
                <img
                  className="about-app-icon"
                  src={appIcon}
                  alt=""
                  width={72}
                  height={72}
                />
                <h2>AI Coding Usage</h2>
                <p>Version {appVersion} · MIT licensed</p>
                <p>
                  Usage and pricing authority:{" "}
                  <a
                    className="about-repository"
                    href={ccusageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleExternalLink}
                  >
                    ccusage 20.0.48
                    <UIcon name="external" size={14} />
                  </a>
                  .
                </p>
                <a
                  className="about-repository"
                  href={repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleExternalLink}
                >
                  huseyint/agent-usage on GitHub
                  <UIcon name="external" size={14} />
                </a>
              </div>
              <div className="about-support">
                <div>
                  <strong>Enjoying AI Coding Usage?</strong>
                  <p>
                    Give the project a star on GitHub to show your support and
                    help others discover it.
                  </p>
                </div>
                <a
                  className="primary-button"
                  href={repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleExternalLink}
                >
                  <UIcon name="star" size={15} />
                  Star on GitHub
                </a>
              </div>
              <div className="about-info">
                <div>
                  <span>Engine source revision</span>
                  <code>2c92293e0a1d6a395c6a10a23267855e3205a1a6</code>
                </div>
                <div>
                  <span>New application code</span>
                  <strong>MIT</strong>
                </div>
                <div>
                  <span>ccusage</span>
                  <strong>MIT · bundled third-party notice</strong>
                </div>
              </div>
              <p className="section-description">
                Not affiliated with OpenAI, Anthropic, or ccusage maintainers.
                Estimated API-equivalent costs are not Claude or ChatGPT
                subscription charges. Third-party licenses are included in the
                app bundle and source repository.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
export function Onboarding() {
  const u = useUsage();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [step, setStep] = useState(0);
  const show = isDesktop && !!u.bootstrap.data && !u.prefs.onboarded;
  useEffect(() => {
    if (show) dialog.current?.showModal();
    else dialog.current?.close();
  }, [show]);
  async function finish(settings = false) {
    try {
      await u.savePreferences.mutateAsync({
        ...u.prefs,
        timezone,
        onboarded: true,
      });
      if (settings) navigate("/settings");
    } catch {}
  }
  if (!show) return null;
  return (
    <dialog
      ref={dialog}
      className="onboarding-dialog"
      aria-labelledby="onboarding-title"
      onCancel={(e) => e.preventDefault()}
    >
      <div className="onboarding-mark">
        <UIcon name={step ? "shield" : "activity"} size={30} />
      </div>
      <h1 id="onboarding-title">
        {step ? "Local sources" : "Welcome to AI Coding Usage"}
      </h1>
      <p>
        {step
          ? "We read local Claude Code and Codex logs to show token usage and API-equivalent estimates. No accounts, credentials, or transcript uploads."
          : "See which sessions, projects, and models account for your recorded usage. Everything runs on your device."}
      </p>
      {step === 0 ? (
        <div className="onboarding-features">
          <span>
            <UIcon name="sessions" size={18} />
            Named sessions, with context
          </span>
          <span>
            <UIcon name="reports" size={18} />
            API-equivalent cost estimates
          </span>
          <span>
            <UIcon name="shield" size={18} />
            Read-only local sources
          </span>
        </div>
      ) : (
        <>
          <div className="onboarding-sources">
            {["claude", "codex"].map((p) => (
              <div key={p}>
                <ProviderMark provider={p} label />
                <span className="subtle-badge">
                  {u.bootstrap.data?.sources.some(
                    (s) => s.provider === p && s.status === "ready",
                  )
                    ? "Detected"
                    : "Not detected"}
                </span>
              </div>
            ))}
          </div>
          <label className="onboarding-timezone">
            Display timezone
            <TimezoneSelect value={timezone} onChange={setTimezone} />
          </label>
          <p className="fine-print">
            Prompt title fallback is on by default; you can disable and purge
            derived titles in Settings. Closing the window hides to tray when
            available. Use Quit to exit.
          </p>
        </>
      )}
      <div className="onboarding-actions">
        {step === 0 ? (
          <button className="primary-button" onClick={() => setStep(1)}>
            Get started <UIcon name="arrow" size={16} />
          </button>
        ) : (
          <>
            <button
              className="primary-button"
              disabled={u.savePreferences.isPending}
              onClick={() => void finish()}
            >
              Go to dashboard
              <UIcon name="arrow" size={16} />
            </button>
            <button className="text-button" onClick={() => void finish(true)}>
              Configure sources first
            </button>
          </>
        )}
        <span>{step + 1} / 2</span>
      </div>
    </dialog>
  );
}
