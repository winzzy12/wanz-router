/**
 * Clipboard writes, owned by the pattern that reports them.
 *
 * The only caller is `useClipboard`, which every copy affordance in the
 * dashboard goes through — so the origin/permission failure is answered once,
 * by {@link ClipboardButton}. A raw `navigator.clipboard.writeText` at a call
 * site produces an unhandled rejection on an insecure origin and a button that
 * silently does nothing.
 *
 * ## Why there is a legacy path
 *
 * `navigator.clipboard` only exists in a **secure context**: HTTPS, or
 * `http://localhost`. A self-hosted gateway is commonly opened at
 * `http://<lan-ip>:<port>` — a plain-HTTP origin that browsers do not treat as
 * secure — so the modern API is `undefined` there and every copy button failed
 * with "Clipboard unavailable on this origin", even though the copy itself is
 * perfectly possible.
 *
 * `document.execCommand("copy")` has no secure-context requirement. It is
 * deprecated, but it is the only synchronous copy primitive available on those
 * origins, and it is what keeps every copy affordance working on a LAN install.
 * The modern API stays first because it is the correct one wherever it exists
 * (and it does not depend on a temporary DOM node).
 */

/**
 * Copies `value` with the modern API when available, falling back to the
 * legacy selection-based path on an insecure origin.
 *
 * Resolves `false` only when both paths fail, so callers keep a single
 * "could not copy" branch instead of guessing at the cause.
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permissions policy, a denied prompt, or a non-focused document. Fall
      // through: the legacy path succeeds in several of those cases.
    }
  }
  return copyWithSelection(value);
}

/**
 * Legacy copy: mount an off-screen textarea, select it, and copy the selection.
 *
 * The textarea is positioned `fixed` and made transparent rather than moved off
 * screen: an element outside the viewport cannot be focused or scrolled into
 * view reliably, and focusing it would jump the page. The previously focused
 * element is restored afterwards so the operator's place in the UI is kept.
 */
function copyWithSelection(value: string): boolean {
  let textarea: HTMLTextAreaElement | null = null;
  const previouslyFocused = document.activeElement as HTMLElement | null;
  try {
    textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.setAttribute("aria-hidden", "true");
    textarea.tabIndex = -1;
    Object.assign(textarea.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "1px",
      height: "1px",
      padding: "0",
      border: "none",
      outline: "none",
      boxShadow: "none",
      background: "transparent",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    // iOS Safari ignores `select()` on a readonly field in some versions and
    // needs an explicit range before `execCommand` becomes a no-op.
    textarea.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea?.remove();
    previouslyFocused?.focus?.({ preventScroll: true });
  }
}
