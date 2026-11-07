import { useEffect, useRef, useState } from "react";
import { useUsage } from "@/lib/usage-context";
import { UIcon } from "./usage-icon";

export function MetadataStatus() {
  const u = useUsage();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const warnings = Array.from(
    new Set(
      (u.view.data?.warnings || []).filter((warning) =>
        warning.startsWith("Session metadata"),
      ),
    ),
  );
  const sources = u.view.data?.sources || u.bootstrap.data?.sources || [];
  const sourceWarnings = sources.filter((source) => source.warning);
  const hasWarning = warnings.length > 0 || sourceWarnings.length > 0;

  useEffect(() => {
    if (!open || !hasWarning) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key);
    };
  }, [open, hasWarning]);

  if (!hasWarning) return null;
  return (
    <div className="metadata-status" ref={container}>
      <button
        ref={trigger}
        className="metadata-status-trigger"
        aria-expanded={open}
        aria-controls="metadata-details"
        onClick={() => setOpen(!open)}
      >
        <UIcon name="info" size={13} />
        <span>Session metadata incomplete</span>
      </button>
      {open && (
        <section
          id="metadata-details"
          className="metadata-popover"
          aria-label="Session metadata status"
        >
          <header>
            <h2>Session metadata</h2>
            <button
              className="icon-button"
              aria-label="Close metadata details"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <UIcon name="close" size={13} />
            </button>
          </header>
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {sourceWarnings.map((source) => (
            <p key={source.id}>
              <strong>
                {source.provider === "claude" ? "Claude Code" : "Codex"}
              </strong>
              <br />
              {source.warning}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
