// Adapted layout and note styling under the MIT license. See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef } from "react";
import { releases } from "@/lib/releases";
import { Icon } from "./icon";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function InlineNote({ text }: { text: string }) {
  return text.split(/(`[^`\n]+`)/g).map((part, index) => {
    if (!part.startsWith("`") || !part.endsWith("`")) return part;
    const content = part.slice(1, -1);
    return content.startsWith("⌘") ? (
      <kbd key={index}>{content}</kbd>
    ) : (
      <code key={index}>{content}</code>
    );
  });
}

export function WhatsNewDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    element.showModal();
    element.focus();
    return () => {
      element.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="whats-new-dialog"
      aria-labelledby="whats-new-heading"
      tabIndex={-1}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="whats-new-layout">
        <header className="whats-new-header">
          <span className="whats-new-mark" aria-hidden="true">
            AU
          </span>
          <h2 id="whats-new-heading">What’s new in AI Coding Usage</h2>
          <button
            className="icon-button"
            aria-label="Close what’s new"
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div
          className="release-list"
          role="region"
          aria-label="Release notes"
          tabIndex={0}
        >
          {releases.map((release, index) => (
            <section
              key={release.version}
              className="release-card"
              aria-labelledby={`release-${release.version}`}
            >
              <div className="release-heading">
                <h3
                  id={`release-${release.version}`}
                  className="release-version"
                >
                  {release.version}
                </h3>
                {index === 0 && <span className="release-latest">Latest</span>}
                <time dateTime={release.date}>
                  {dateFormat.format(new Date(`${release.date}T00:00:00Z`))}
                </time>
              </div>
              <ul>
                {release.items.map((item) => (
                  <li key={item}>
                    <span className="release-bullet" aria-hidden="true" />
                    <span>
                      <InlineNote text={item} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!releases.length && (
            <p className="release-empty">No release notes yet.</p>
          )}
        </div>
        <footer className="whats-new-footer">
          <span>AI Coding Usage</span>
          <span>Esc to close</span>
        </footer>
      </div>
    </dialog>
  );
}
