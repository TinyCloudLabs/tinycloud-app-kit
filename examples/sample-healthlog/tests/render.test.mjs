// jsdom render tests: the today card on its own, and the whole app driven through the shim.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { JSDOM } from "jsdom";

// --- browser globals, installed before React / recharts are imported -------------------------
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://app.invalid/", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Node", "Event", "MouseEvent", "FocusEvent", "SVGElement", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
// recharts' ResponsiveContainer needs a size: report __roWidth x 240 (default 600) for every observed element.
globalThis.__roWidth = 600;
globalThis.ResizeObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) {
    this.cb([{ target: el, contentRect: { width: globalThis.__roWidth, height: 240 }, borderBoxSize: [{ inlineSize: globalThis.__roWidth, blockSize: 240 }], contentBoxSize: [{ inlineSize: globalThis.__roWidth, blockSize: 240 }] }], this);
  }
  unobserve() {}
  disconnect() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { loadApp } = await import("../dev/build.mjs");
const { freshStack } = await import("./lib/env.mjs");
const { nodeSkipReason } = await import("./lib/node.mjs");
const SKIP = nodeSkipReason();
if (SKIP) console.warn(`SKIP: ${SKIP}`);
const { sql } = await import("../dev/shim.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sel) => document.querySelector(sel);
const text = (sel) => q(sel)?.textContent;

async function waitFor(check, { timeout = 8000, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    let v;
    await act(async () => {
      await sleep(25);
      v = check();
    });
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n${document.body.innerHTML.slice(0, 1500)}`);
  }
}

function setValue(el, value) {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new window.Event(el instanceof window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
const blur = (el) => el.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
const submit = (form) => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

let app;
let root;
function mount(element) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  return act(async () => root.render(element));
}
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}

before(async () => {
  app = await loadApp();
});

describe("today card", () => {
  after(unmount);

  test("renders totals, macros, meals and weight from a day_card row", async () => {
    await mount(
      React.createElement(app.TodayCard, {
        day: "2026-10-20",
        card: { day: "2026-10-20", kcal: 1070, protein_g: 66, carbs_g: 118, fat_g: 33, meals: 2, weight_kg: 81 },
        meals: [
          { id: 1, slot: "lunch", name: "Lentil soup", kcal: 420 },
          { id: 2, slot: "dinner", name: "Salmon and rice", kcal: 650 },
        ],
        goals: { kcal: 2000 },
      }),
    );
    assert.equal(text('[data-testid="today-day"]'), "2026-10-20");
    assert.equal(text('[data-testid="today-kcal"]'), "1,070");
    assert.equal(text('[data-testid="today-protein"]'), "66 g");
    assert.equal(text('[data-testid="today-carbs"]'), "118 g");
    assert.equal(text('[data-testid="today-fat"]'), "33 g");
    assert.equal(text('[data-testid="today-meals-count"]'), "2 meals");
    assert.equal(text('[data-testid="today-weight"]'), "81 kg");
    assert.equal(q('[data-testid="today-progress"]').style.width, "54%");
    assert.equal(document.querySelectorAll('[data-testid="today-meals"] li').length, 2);
    assert.match(text('[data-testid="today-meals"]'), /Salmon and rice/);
  });

  test("an empty day shows zeros and no weight", async () => {
    await mount(React.createElement(app.TodayCard, { day: "2026-10-21", card: null, meals: [], goals: { kcal: 2000 } }));
    assert.equal(text('[data-testid="today-kcal"]'), "0");
    assert.equal(text('[data-testid="today-meals-count"]'), "0 meals");
    assert.equal(text('[data-testid="today-weight"]'), "No weight yet");
    assert.equal(q('[data-testid="today-meals"]'), null);
  });
});

describe("daily target input", () => {
  after(unmount);
  const target = () => q('[aria-label="Daily target kcal"]');
  const alertText = () => q('[role="alert"]')?.textContent ?? null;
  async function mountCard(onGoal) {
    await mount(React.createElement(app.TodayCard, { day: "2026-10-20", card: null, meals: [], goals: { kcal: 2000 }, onGoal }));
  }
  async function commit(value) {
    await act(async () => setValue(target(), value));
    await act(async () => blur(target()));
  }

  test("an invalid target shows an alert, keeps the previous value and stores nothing", async () => {
    const calls = [];
    await mountCard(async (n) => { calls.push(n); return { ok: true }; });
    for (const bad of ["abc", "", "0", "499", "10001", "2300.5", "1e3", "-2000", "2 000"]) {
      await commit(bad);
      assert.equal(alertText(), app.GOAL_MESSAGE, `no alert for ${JSON.stringify(bad)}`);
      assert.equal(target().value, "2000", `value not restored after ${JSON.stringify(bad)}`);
      assert.equal(target().getAttribute("aria-invalid"), "true");
    }
    assert.deepEqual(calls, []);
  });

  test("a valid target is saved, clears the alert, and typing clears a stale alert", async () => {
    const calls = [];
    await mountCard(async (n) => { calls.push(n); return { ok: true }; });
    await commit("abc");
    assert.ok(alertText());
    await act(async () => setValue(target(), "2"));
    assert.equal(alertText(), null, "typing clears the alert");
    await commit("2300");
    assert.deepEqual(calls, [2300]);
    assert.equal(alertText(), null);
  });

  test("a failed save shows its message and keeps the previous value", async () => {
    await mountCard(async () => ({ ok: false, error: { code: "TIMEOUT", message: "No answer within 30000 ms." } }));
    await commit("2300");
    assert.equal(alertText(), "No answer within 30000 ms.");
    assert.equal(target().value, "2000");
  });

  test("an unchanged target is not saved and shows no alert", async () => {
    const calls = [];
    await mountCard(async (n) => { calls.push(n); return { ok: true }; });
    await commit("2000");
    assert.deepEqual(calls, []);
    assert.equal(alertText(), null);
  });

  test("a target of 0 coming from storage cannot produce a NaN progress bar", async () => {
    await mount(React.createElement(app.TodayCard, { day: "d", card: { kcal: 500, meals: 1 }, meals: [], goals: { kcal: 0 } }));
    assert.equal(q('[data-testid="today-progress"]').style.width, "0%");
  });
});

describe("week chart", () => {
  after(async () => {
    globalThis.__roWidth = 600;
    await unmount();
  });
  const days = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"];
  const makeRows = () => days.map((day, i) => ({
    day, label: app.weekdayLabel(day), kcal: i === 3 ? 0 : 1000 + i * 100, meals: i === 3 ? 0 : 2, protein_g: 0, carbs_g: 0, fat_g: 0, weight_kg: i === 3 ? null : 82 - i * 0.2,
  }));

  test("the chart draws all seven weekday labels, a legend names both series, and an accessible summary lists every day (label dropping at 390 px needs real layout: checked in a browser, see README)", async () => {
    globalThis.__roWidth = 324; // the chart's width inside a 390 px viewport
    await mount(React.createElement(app.WeekChart, { rows: makeRows() }));
    await waitFor(() => [...document.querySelectorAll("svg text")].some((t) => t.textContent === "Wed"), { what: "x axis labels" });
    const labels = [...document.querySelectorAll("svg text")].map((e) => e.textContent).filter((t) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(t));
    assert.deepEqual(labels, ["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"]);
    assert.match(text('[data-testid="week-legend"]'), /Calories \(bars, left axis, kcal\)/);
    assert.match(text('[data-testid="week-legend"]'), /Weight \(line, right axis, kg\)/);
    const label = q('[data-testid="week-chart-plot"]').getAttribute("aria-label");
    for (const d of ["Wed: 1,000 kcal", "Sat: no meals", "Tue: 1,600 kcal, 80.8 kg"]) assert.ok(label.includes(d), `${d} missing from: ${label}`);
    assert.equal(label.split("; ").length, 7);
  });
});

describe("whole app through the bridge shim", { skip: SKIP }, () => {
  let stack;
  before(async () => {
    stack = await freshStack();
    await stack.install();
  });
  after(async () => {
    await unmount();
    await stack?.stop();
  });

  test("first open provisions the schema, shows an empty today card and the chart", async () => {
    const clock = () => new Date(2026, 9, 20, 12, 0, 0); // local time: 2026-10-20
    await mount(React.createElement(app.default, { now: clock }));
    await waitFor(() => q('[data-testid="today-card"]'), { what: "today card" });
    assert.equal(text('[data-testid="today-day"]'), "2026-10-20");
    assert.equal(text('[data-testid="today-kcal"]'), "0");
    await waitFor(() => q(".recharts-wrapper"), { what: "chart" });
    assert.match(text('[data-testid="week-summary"]'), /0 of 7 days logged/);
  });

  test("logging a meal in the UI writes one row and updates the card", async () => {
    setValue(q('[aria-label="Meal name"]'), "Greek yogurt");
    setValue(q('[aria-label="Calories"]'), "180");
    setValue(q('[aria-label="Protein (g)"]'), "17");
    setValue(q('[aria-label="Carbs (g)"]'), "9");
    setValue(q('[aria-label="Fat (g)"]'), "8");
    setValue(q('[aria-label="Slot"]'), "snack");
    const form = q('[data-testid="meal-form"]');
    // a double submit before the first answer arrives must not write twice
    await act(async () => {
      submit(form);
      submit(form);
    });
    await waitFor(() => text('[data-testid="meal-message"]') === "Meal logged.", { what: "meal message" });
    await waitFor(() => text('[data-testid="today-kcal"]') === "180", { what: "card update" });
    assert.equal(text('[data-testid="today-protein"]'), "17 g");
    assert.equal(text('[data-testid="today-meals-count"]'), "1 meal");
    assert.match(text('[data-testid="today-meals"]'), /Greek yogurt/);
    const rows = await sql.query("healthlog", "SELECT name, slot, kcal, day FROM meal");
    assert.deepEqual(rows.rows, [["Greek yogurt", "snack", 180, "2026-10-20"]]);
    assert.equal(q('[aria-label="Meal name"]').value, "", "form resets after success");
  });

  test("a rejected meal keeps the form and shows why", async () => {
    setValue(q('[aria-label="Meal name"]'), "Mystery");
    setValue(q('[aria-label="Calories"]'), "99999");
    await act(async () => submit(q('[data-testid="meal-form"]')));
    await waitFor(() => /Calories must be/.test(text('[data-testid="meal-message"]') ?? ""), { what: "error message" });
    assert.equal(q('[aria-label="Meal name"]').value, "Mystery");
    assert.equal((await sql.query("healthlog", "SELECT COUNT(*) FROM meal")).rows[0][0], 1);
  });

  test("logging weight updates the card", async () => {
    setValue(q('[aria-label="Weight (kg)"]'), "80.4");
    await act(async () => submit(q('[data-testid="weight-form"]')));
    await waitFor(() => text('[data-testid="today-weight"]') === "80.4 kg", { what: "weight on card" });
    assert.equal((await sql.query("healthlog", "SELECT weight_kg FROM weight")).rows[0][0], 80.4);
  });

  test("the chart summary counts the logged day", async () => {
    await waitFor(() => /1 of 7 days logged, 180 kcal average/.test(text('[data-testid="week-summary"]') ?? ""), { what: "week summary" });
  });
});
