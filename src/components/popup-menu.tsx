import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Menu } from "@tauri-apps/api/menu";
import { isDesktop } from "@/lib/desktop";
import { UIcon } from "./usage-icon";

interface PopupItem {
  id: string;
  label: string;
  icon?: ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function PopupMenu({
  label,
  icon,
  iconOnly = false,
  disabled = false,
  native = true,
  items,
}: {
  label: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  disabled?: boolean;
  native?: boolean;
  items: PopupItem[];
}) {
  const useNativeMenu = isDesktop && native;
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const menu = useRef<Menu | null>(null);
  const creating = useRef(false);

  useEffect(
    () => () => {
      void menu.current?.close();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const buttons = () =>
      Array.from(
        container.current?.querySelectorAll<HTMLButtonElement>(
          "[role^='menuitem']:not(:disabled)",
        ) || [],
      );
    buttons()[0]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      } else if (event.key === "Tab") {
        setOpen(false);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const entries = buttons();
        const index = entries.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? entries.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  entries.length) %
                entries.length;
        entries[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    container.current?.addEventListener("keydown", key);
    const element = container.current;
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      element?.removeEventListener("keydown", key);
    };
  }, [open]);

  async function show() {
    if (!useNativeMenu) {
      setOpen(!open);
      return;
    }
    if (creating.current) return;
    creating.current = true;
    try {
      const [{ Menu }, { LogicalPosition }] = await Promise.all([
        import("@tauri-apps/api/menu"),
        import("@tauri-apps/api/dpi"),
      ]);
      await menu.current?.close();
      menu.current = await Menu.new({
        items: items.map((item) => ({
          id: item.id,
          text: item.label,
          enabled: !item.disabled,
          ...(item.checked === undefined ? {} : { checked: item.checked }),
          action: () => item.onSelect(),
        })),
      });
      const bounds = trigger.current?.getBoundingClientRect();
      if (bounds)
        await menu.current.popup(
          new LogicalPosition(bounds.left, bounds.bottom + 4),
        );
    } catch {
      setOpen(true);
    } finally {
      creating.current = false;
    }
  }

  return (
    <div className="popup-menu" ref={container}>
      <button
        ref={trigger}
        type="button"
        className={iconOnly ? "icon-button" : "popup-menu-trigger"}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={useNativeMenu && !open ? undefined : open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => void show()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            void show();
          }
        }}
      >
        {icon}
        {!iconOnly && (
          <>
            <span>{label}</span>
            <UIcon name="chevron-down" size={10} />
          </>
        )}
      </button>
      {open && (
        <div id={id} className="dropdown-panel" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.id}
              role={
                item.checked === undefined ? "menuitem" : "menuitemcheckbox"
              }
              aria-checked={item.checked}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                item.onSelect();
              }}
            >
              <span className="menu-check">
                {item.checked && <UIcon name="check" size={13} />}
              </span>
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
