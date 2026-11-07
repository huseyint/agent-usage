import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { UIcon } from "./usage-icon";

export function FilterMultiSelect({
  label,
  hideLabel = false,
  options,
  selected,
  onToggle,
  onClear,
  renderOption,
}: {
  label: string;
  hideLabel?: boolean;
  options: { value: string; label: string; title?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  renderOption?: (option: { value: string; label: string }) => ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const matches = options.filter((option) =>
    `${option.label} ${option.value}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const summary =
    selected.length === 0
      ? `All ${label.toLowerCase()}`
      : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label ||
          selected[0]
        : `${selected.length} ${label.toLowerCase()} selected`;

  useEffect(() => {
    if (!open) return;
    setSearch("");
    searchInput.current?.focus();
    const dismiss = (event: Event) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    // Clicking a checkbox in WebKit can blur the search without focusing the
    // checkbox. Only dismiss when focus actually lands outside the dropdown.
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  return (
    <div
      className="filter-field filter-multi-select"
      ref={container}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === "ArrowDown" && event.target === trigger.current) {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      <span id={`${id}-label`} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="filter-select-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span id={`${id}-value`}>
          {selected.length === 1 && renderOption
            ? renderOption({ value: selected[0], label: summary })
            : summary}
        </span>
        <UIcon name="chevron-down" size={12} />
      </button>
      {open && (
        <div
          id={id}
          className="filter-select-panel"
          role="dialog"
          aria-labelledby={`${id}-label`}
        >
          <div className="filter-select-search">
            <UIcon name="search" size={14} />
            <input
              ref={searchInput}
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder={`Search ${label.toLowerCase()}…`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="filter-select-options">
            {matches.map((option) => (
              <label key={option.value} title={option.title || option.label}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => onToggle(option.value)}
                />
                <span>
                  {renderOption ? renderOption(option) : option.label}
                </span>
              </label>
            ))}
            {matches.length === 0 && (
              <p className="filter-select-empty">
                No {label.toLowerCase()} found
              </p>
            )}
          </div>
          <div className="filter-select-footer">
            <span>
              {selected.length
                ? `${selected.length} selected`
                : `All ${label.toLowerCase()}`}
            </span>
            <button
              type="button"
              disabled={!selected.length}
              onClick={() => {
                onClear();
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
