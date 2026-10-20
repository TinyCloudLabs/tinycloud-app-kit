// Static scan of app.jsx for things a sandboxed tiny app must not do.
//
// DEFENCE IN DEPTH ONLY. This is a source-text scan: a determined author can write code it does not
// recognise, and it is NOT the security boundary. The real boundary is the runner's sandbox: opaque-origin
// frames, a CSP with `connect-src 'none'` (and no other network-capable directive), no storage and no direct
// access to the parent, enforced by the browser (T5b / the S3 JSX sandbox). The scan exists to catch honest
// mistakes and the obvious escape hatches early, in review and in CI.
const BANNED_SUBSTRINGS = [
  "fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "RTCPeerConnection", "WebTransport",
  "eval(", "new Function", "Function(", "importScripts", "import(", "Worker(", "SharedWorker", "navigator.serviceWorker",
  "localStorage", "sessionStorage", "indexedDB", "document.cookie", "caches.",
  "postMessage", "window.parent", "window.top", "window.opener", "window.open", "location.href", "location.assign", "location.replace",
  "dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "srcdoc",
  "new Image", "Image(", "createElement(", "setAttribute(", "<script", "<iframe", "<img", "<link", "<form action",
];

const BANNED_PATTERNS = [
  [/\bhttps?:\/\//i, "an http(s):// URL"],
  [/\b(?:globalThis|window|self|document|top|parent|frames)\s*\[/, "bracket access on a global (globalThis[...], window[...], ...)"],
  [/\.\s*(?:src|href|action|srcset)\s*=(?!=)/, "assigning a URL-bearing property (.src = ..., .href = ...)"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\brequire\s*\(/, "require()"],
  [/\bwith\s*\(/, "with statement"],
  [/\bReflect\s*\.\s*(?:get|apply|construct)\b/, "Reflect.get/apply/construct"],
  [/\[\s*["'`](?:fetch|eval|Function|XMLHttpRequest|WebSocket|Image)["'`]\s*\]/, "bracket access to a network or eval name"],
];

/** Imports other than these are refused. */
export const ALLOWED_IMPORTS = ["@tinycloud/app", "react", "recharts"];

export function importSpecifiers(src) {
  return [...src.matchAll(/^\s*(?:import|\}\s*from)\s.*?from\s+"([^"]+)"|^\} from "([^"]+)"|^import\s+"([^"]+)"/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** Returns a list of violations (empty when clean). */
export function scanSource(src) {
  const found = [];
  for (const b of BANNED_SUBSTRINGS) if (src.includes(b)) found.push(`uses ${b}`);
  for (const [re, what] of BANNED_PATTERNS) if (re.test(src)) found.push(`contains ${what}`);
  for (const spec of importSpecifiers(src)) if (!ALLOWED_IMPORTS.includes(spec)) found.push(`imports ${spec}`);
  return found;
}
