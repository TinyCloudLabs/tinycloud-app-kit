// A tiny jsdom + react-dom/client harness (no testing-library dependency).
import { JSDOM } from "jsdom";

// The DOM must exist before react-dom is first evaluated: it decides at load time
// whether the browser supports `input` events (and so whether onChange fires).
function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  for (const key of ["HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLButtonElement", "Node", "Element", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle"]) {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

installDom();
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mount(Component) {
  const container = document.getElementById("root");
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Component)));
  return {
    container,
    unmount: () => act(async () => root.unmount()),
  };
}

/** Wait (inside act, so effects and state updates flush) until `fn()` (sync or async) is truthy; returns its value. */
export async function waitFor(fn, { timeout = 8000, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch (e) {
      last = e;
    }
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ""}\n${document.body.textContent.slice(0, 600)}`);
    await act(async () => sleep(25));
  }
}

const norm = (s) => s.replace(/\s+/g, " ").trim();
export const text = () => norm(document.body.textContent);

export function button(name) {
  const re = name instanceof RegExp ? name : new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return [...document.querySelectorAll("button")].find((b) => re.test(norm(b.getAttribute("aria-label") ?? b.textContent)));
}

export async function click(el) {
  if (!el) throw new Error("click: element not found");
  await act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })));
}

/** The control inside the <label> whose text starts with `labelText`, or one with that aria-label. */
export function field(labelText) {
  const byAria = [...document.querySelectorAll("[aria-label]")].find((e) => e.getAttribute("aria-label") === labelText);
  if (byAria) return byAria;
  const label = [...document.querySelectorAll("label")].find((l) => norm(l.textContent).startsWith(labelText));
  return label?.querySelector("input, textarea, select");
}

export async function set(el, value) {
  if (!el) throw new Error("set: field not found");
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

export async function submit(form) {
  await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
