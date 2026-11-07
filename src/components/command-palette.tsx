import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icon";

export interface Command {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = commands.filter((command) =>
    `${command.label} ${command.keywords ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    element.showModal();
    input.current?.focus();
    return () => {
      element.close();
      previousFocus?.focus();
    };
  }, []);

  function run(command: Command) {
    onClose();
    command.run();
  }

  return (
    <dialog
      ref={dialog}
      className="command-dialog"
      aria-label="Commands"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-content">
        <div className="command-search">
          <Icon name="search" size={20} />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="What would you like to do?"
            role="combobox"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={
              filtered[active] ? `command-${filtered[active].id}` : undefined
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (filtered.length)
                  setActive(
                    (index) =>
                      (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        filtered.length) %
                      filtered.length,
                  );
              }
              if (event.key === "Enter" && filtered[active]) {
                event.preventDefault();
                run(filtered[active]);
              }
            }}
          />
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close commands"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="command-list-label">QUICK ACTIONS</div>
        <div
          id="command-list"
          role="listbox"
          aria-label="Available commands"
          className="command-list"
        >
          {filtered.length ? (
            filtered.map((command, index) => (
              <div
                key={command.id}
                id={`command-${command.id}`}
                role="option"
                aria-selected={index === active}
                className={`command-item ${index === active ? "active" : ""}`}
                onMouseMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(command)}
              >
                <Icon name={command.icon} size={17} />
                <span>{command.label}</span>
                {command.shortcut && <kbd>{command.shortcut}</kbd>}
              </div>
            ))
          ) : (
            <p className="command-no-results">
              No commands found. Try “settings” or “theme”.
            </p>
          )}
        </div>
        <div className="command-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>↵</kbd> to select
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </dialog>
  );
}
