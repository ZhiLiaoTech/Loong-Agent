import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./ChatComposer.module.css";

export interface ChatToolbarMenuOption {
  value: string;
  label: string;
  hint?: string;
}

export function ChatToolbarMenu({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  icon,
  title,
}: {
  value: string;
  options: readonly ChatToolbarMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  icon?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find(option => option.value === value) ?? options[0];

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  return (
    <div className={styles.menuWrap} ref={rootRef}>
      <button
        type="button"
        className={styles.scopePill}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        title={title}
        onClick={() => setOpen(current => !current)}
      >
        {icon ? <span className={styles.scopeIcon} aria-hidden>{icon}</span> : null}
        <span className={styles.menuLabel}>{selected?.label ?? "—"}</span>
        <span className={styles.chevron} aria-hidden>▾</span>
      </button>

      {open ? (
        <ul id={listId} className={styles.menuList} role="listbox" aria-label={ariaLabel}>
          {options.map(option => {
            const active = option.value === value;
            return (
              <li key={option.value || "__auto__"} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={active ? `${styles.menuItem} ${styles.menuItemActive}` : styles.menuItem}
                  title={option.hint}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
