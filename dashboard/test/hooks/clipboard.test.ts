/**
 * Clipboard writes must work on an insecure origin.
 *
 * A self-hosted gateway is routinely opened at `http://<lan-ip>:<port>` — a
 * plain-HTTP origin, which browsers do NOT treat as a secure context. There
 * `navigator.clipboard` is `undefined`, so the modern-only implementation made
 * every copy button (gateway endpoint, API key, update command) report
 * "Clipboard unavailable on this origin" while the copy itself was perfectly
 * possible.
 *
 * These tests pin the two halves of the contract: the modern API is preferred
 * where it exists, and the legacy selection path carries the call where it does
 * not.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { copyToClipboard } from "../../src/hooks/clipboard";

interface ClipboardStub {
  writeText(value: string): Promise<void>;
}

/** Replaces `navigator.clipboard`; pass `undefined` to model an insecure origin. */
function setClipboard(stub: ClipboardStub | undefined): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: stub,
  });
}

/**
 * Minimal DOM surface the legacy path touches.
 *
 * Deliberately hand-rolled rather than happy-dom: the fallback only needs
 * `createElement`, `body.appendChild/removeChild`, `activeElement`, and
 * `execCommand`, and a fake makes "did the textarea hold the value" and "did
 * execCommand run" directly observable instead of inferred from a real DOM.
 */
function installDom(execResult: boolean): {
  execCalls: () => number;
  copiedText: () => string | null;
  removed: () => number;
} {
  let execCalls = 0;
  let copiedText: string | null = null;
  let removals = 0;

  const textarea = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute(): void {},
    focus(): void {},
    select(): void {
      copiedText = textarea.value;
    },
    setSelectionRange(): void {},
    remove(): void {
      removals += 1;
    },
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      activeElement: null,
      createElement: () => textarea,
      body: {
        appendChild(): void {},
      },
      execCommand: (command: string): boolean => {
        if (command !== "copy") throw new Error(`unexpected command ${command}`);
        execCalls += 1;
        return execResult;
      },
    },
  });

  return {
    execCalls: () => execCalls,
    copiedText: () => copiedText,
    removed: () => removals,
  };
}

afterEach(() => {
  setClipboard(undefined);
  Reflect.deleteProperty(globalThis, "document");
});

describe("copyToClipboard", () => {
  test("uses the modern API when the origin is secure", async () => {
    const written: string[] = [];
    setClipboard({ writeText: async (value) => void written.push(value) });
    const dom = installDom(true);

    expect(await copyToClipboard("https://gateway.example/v1")).toBe(true);
    expect(written).toEqual(["https://gateway.example/v1"]);
    // The legacy path must not run when the modern one succeeded.
    expect(dom.execCalls()).toBe(0);
  });

  test("falls back to the selection path when the modern API is absent", async () => {
    // The exact insecure-origin shape: no clipboard object at all.
    setClipboard(undefined);
    const dom = installDom(true);

    expect(await copyToClipboard("sk-wanz-123")).toBe(true);
    expect(dom.execCalls()).toBe(1);
    expect(dom.copiedText()).toBe("sk-wanz-123");
  });

  test("falls back when the modern API rejects (denied permission)", async () => {
    setClipboard({
      writeText: async () => {
        throw new Error("NotAllowedError");
      },
    });
    const dom = installDom(true);

    expect(await copyToClipboard("endpoint")).toBe(true);
    expect(dom.execCalls()).toBe(1);
  });

  test("reports failure when both paths fail", async () => {
    setClipboard(undefined);
    const dom = installDom(false);

    expect(await copyToClipboard("nothing")).toBe(false);
    expect(dom.execCalls()).toBe(1);
  });

  test("always removes the temporary textarea", async () => {
    setClipboard(undefined);
    const dom = installDom(false);

    await copyToClipboard("cleanup");
    expect(dom.removed()).toBe(1);
  });
});
