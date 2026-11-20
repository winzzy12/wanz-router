import { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";

/**
 * The language switch in the console topbar.
 *
 * The language control is a placeholder on purpose: wiring it to a real
 * translation catalogue is a larger change than the button, and shipping the
 * catalogue half-done would leave the UI in two languages at once. It shows the
 * current locale and is inert until the catalogue lands.
 */

/** Locales the placeholder offers; only the first is actually applied. */
const LOCALES = [
  { id: "en", label: "EN", name: "English" },
  { id: "id", label: "ID", name: "Bahasa Indonesia" },
  { id: "zh", label: "中文", name: "简体中文" },
  { id: "ja", label: "日本語", name: "日本語" },
] as const;

function LanguageMenu() {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState<string>("en");
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (container.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = LOCALES.find((entry) => entry.id === locale) ?? LOCALES[0];

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        className="topbar-icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Change language — ${current.name}`}
        title="Change language (coming soon)"
        onClick={() => setOpen((value) => !value)}
      >
        <Languages size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="app-topbar-popover popout-enter glass absolute right-0 top-full z-popover mt-2 min-w-44 rounded-sidebar border border-inner-border bg-popover-bg p-2 shadow-popout"
        >
          {LOCALES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between gap-3 rounded-inset px-3 py-2 text-left text-body text-text-secondary hover:bg-hover-bg hover:text-text-primary"
              onClick={() => {
                setLocale(entry.id);
                setOpen(false);
              }}
            >
              <span>{entry.name}</span>
              {entry.id === locale ? <span className="text-accent-text">✓</span> : null}
            </button>
          ))}
          <p className="px-3 pb-1 pt-2 text-badge leading-snug text-text-tertiary">
            Translations are not wired up yet — the console stays in English for now.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The language switch for the console topbar. */
export function HeaderExtras() {
  return <LanguageMenu />;
}
