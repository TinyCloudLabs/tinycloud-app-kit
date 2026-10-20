// Manifest resolution for the OKF tools. This mirrors how the SDK resolves a
// v1 manifest into capabilities (prefix rules, defaults tiers), reduced to
// what a knowledge bundle needs: which service/space/path grants exist.

export const DEFAULT_SPACE = "applications";

const STANDARD_DEFAULTS = [
  { service: "tinycloud.kv", path: "/", actions: ["get", "put", "del", "list", "metadata"] },
  { service: "tinycloud.sql", path: "/", actions: ["read", "write"] },
];
const ADMIN_DEFAULTS = [
  STANDARD_DEFAULTS[0],
  { service: "tinycloud.sql", path: "/", actions: ["read", "write", "schema"] },
];
const ALL_DEFAULTS = [...ADMIN_DEFAULTS, { service: "tinycloud.duckdb", path: "/", actions: ["read", "write"] }];

export function normalizeService(service) {
  const text = String(service ?? "");
  return text.startsWith("tinycloud.") ? text : `tinycloud.${text}`;
}

function normalizeActions(service, actions) {
  const base = normalizeService(service);
  return (Array.isArray(actions) ? actions : []).map((a) => {
    const text = String(a);
    return text.startsWith(`${base}/`) ? text.slice(base.length + 1) : text;
  });
}

export function applyPrefix(prefix, path, skipPrefix) {
  if (skipPrefix || prefix === "") return path;
  if (path.startsWith("/")) return `${prefix}${path}`;
  return `${prefix}/${path}`;
}

function defaultsTier(value) {
  if (value === false) return "none";
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "admin" || v === "all") return v;
  }
  return "standard";
}

/**
 * Resolves a parsed manifest into app identity plus the full grant list.
 * Each grant: { service, space, path, actions, description, implicit, own }.
 */
export function resolveManifest(manifest) {
  if (typeof manifest.app_id !== "string" || manifest.app_id === "") {
    throw new Error("manifest.app_id must be a non-empty string");
  }
  const space = manifest.space ?? DEFAULT_SPACE;
  const prefix = manifest.prefix ?? manifest.app_id;
  const tier = defaultsTier(manifest.defaults);
  const tierEntries = { none: [], standard: STANDARD_DEFAULTS, admin: ADMIN_DEFAULTS, all: ALL_DEFAULTS }[tier];

  const isOwn = (path) => prefix !== "" && (path === prefix || path.startsWith(`${prefix}/`));
  const grants = [];
  for (const entry of tierEntries) {
    const path = applyPrefix(prefix, entry.path, false);
    grants.push({
      service: entry.service,
      space,
      path,
      actions: [...entry.actions],
      description: "Default app-scoped grant.",
      implicit: true,
      own: true,
    });
  }
  for (const entry of manifest.permissions ?? []) {
    if (entry === null || typeof entry !== "object") continue;
    const service = normalizeService(entry.service);
    if (service === "tinycloud.encryption") continue;
    const path = applyPrefix(prefix, String(entry.path ?? ""), entry.skipPrefix === true);
    const grant = {
      service,
      space: entry.space ?? space,
      path,
      actions: normalizeActions(service, entry.actions),
      description: typeof entry.description === "string" ? entry.description : "",
      implicit: false,
      own: isOwn(path),
    };
    const same = grants.findIndex((g) => g.implicit && g.service === grant.service && g.space === grant.space && g.path === grant.path);
    if (same >= 0) grants.splice(same, 1); // explicit entries override defaults for the same tuple
    grants.push(grant);
  }

  return {
    appId: manifest.app_id,
    name: typeof manifest.name === "string" && manifest.name !== "" ? manifest.name : manifest.app_id,
    description: typeof manifest.description === "string" ? manifest.description : "",
    space,
    prefix,
    tier,
    grants,
    isOwn,
    forkedFrom: manifest.forked_from,
    resources: manifest.resources ?? {},
  };
}

/** Does `grant` cover the resource {service, space, path}? Actions are not compared. */
export function covers(grant, resource) {
  if (grant.service !== resource.service || grant.space !== resource.space) return false;
  if (grant.path === "" || grant.path === "/") return true;
  if (grant.path.endsWith("/")) return resource.path.startsWith(grant.path);
  return resource.path === grant.path;
}

export function coveringGrants(grants, resource) {
  return grants.filter((g) => covers(g, resource));
}

export function formatResource({ service, space, path }) {
  return `${service}:${space}:${path}`;
}

/**
 * Parses `tinycloud.<service>:<space>:<path>` (the CLI `--cap` form without
 * actions). Mirrors the CLI's space/path split, including full space URIs.
 */
export function parseResource(text) {
  const first = text.indexOf(":");
  if (first <= 0) return undefined;
  const service = text.slice(0, first);
  if (!/^tinycloud\.[a-z0-9_-]+$/.test(service)) return undefined;
  const rest = text.slice(first + 1);
  let space;
  let path;
  if (rest.startsWith("tinycloud:")) {
    const parts = rest.split(":");
    if (parts.length < 7) return undefined;
    space = parts.slice(0, 6).join(":");
    path = parts.slice(6).join(":");
  } else {
    const colon = rest.indexOf(":");
    if (colon <= 0) return undefined;
    space = rest.slice(0, colon);
    path = rest.slice(colon + 1);
  }
  return { service, space, path };
}

export function grantedActions(grants, resource) {
  const actions = new Set();
  for (const g of coveringGrants(grants, resource)) for (const a of g.actions) actions.add(a);
  return [...actions];
}
