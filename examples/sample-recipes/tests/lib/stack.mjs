// One throwaway native node, one owner, two apps: the Health Log sample (whose
// data we read across apps) and the Recipes app under test.
//
// Each app gets a signer-less node-sdk client restored from a manifest-scoped
// wallet session. That is what the share runner will hold: a session whose
// ReCap is exactly the app's manifest and no key that could sign for more. A
// wallet-mode client would be wrong here: the SDK escalates a wallet client's
// session on demand, so a write the manifest forbids would still go through.
import { TinyCloudNode } from "@tinycloud/node-sdk";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../../dev/shim.mjs";
import { ROOT } from "./build.mjs";
import { startNode } from "./node.mjs";

const read = (p) => readFileSync(join(ROOT, p), "utf8");
export const recipesManifest = JSON.parse(read("manifest.json"));
export const recipesSchema = read("schema.sql");
export const healthManifest = JSON.parse(read("tests/fixtures/healthlog/healthlog.app.json"));
export const healthSchema = read("tests/fixtures/healthlog/schema.sql");
export const HEALTH_DB = `${healthManifest.app_id}/healthlog`;
export const RECIPES_DB = `${recipesManifest.app_id}/recipes`;

export const splitSql = (text) =>
  text
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

async function appSession({ host, privateKey, manifest }) {
  const wallet = new TinyCloudNode({ privateKey, host, autoCreateSpace: true, manifest });
  await wallet.signIn();
  const node = new TinyCloudNode({ host });
  await node.restoreSession(wallet.session);
  return node;
}

export async function freshStack() {
  const node = await startNode();
  const privateKey = randomBytes(32).toString("hex");

  // The owner: full authority, used only to play the installer and to seed things
  // an app is not allowed to write itself.
  const installerManifest = {
    ...recipesManifest,
    permissions: [
      ...recipesManifest.permissions,
      // T5a: the installer also gets <app_id>/app/ and <app_id>/knowledge/ get/put/list.
      { service: "tinycloud.kv", path: "app/", actions: ["get", "put", "list"] },
      { service: "tinycloud.kv", path: "knowledge/", actions: ["get", "put", "list"] },
    ],
  };
  const owner = new TinyCloudNode({ privateKey, host: node.host, autoCreateSpace: true, manifest: installerManifest });
  await owner.signIn();

  // Health Log first, then Recipes: the dev shim keeps ONE current bridge, and the
  // app under test (Recipes) must be the one `import { sql, kv } from "@tinycloud/app"` sees.
  const healthNode = await appSession({ host: node.host, privateKey, manifest: healthManifest });
  const health = await connect({ manifest: healthManifest, node: healthNode });
  const recipesNode = await appSession({ host: node.host, privateKey, manifest: recipesManifest });
  const recipes = await connect({ manifest: recipesManifest, node: recipesNode });

  const must = (r, what) => {
    if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.error)}`);
    return r;
  };

  return {
    node,
    owner,
    health,
    recipes,
    healthNode,
    recipesNode,
    must,
    /** The installer's job (T5a): put the bundle's schema where the app reads it. Create-only. */
    async install() {
      const r = await owner.kv.put(`${recipesManifest.app_id}/app/schema.sql`, recipesSchema, { contentType: "text/plain" });
      if (!r.ok) throw new Error(`install failed: ${JSON.stringify(r.error)}`);
    },
    /** Stand up the Health Log's database through the Health Log's own session. */
    async provisionHealth() {
      for (const statement of splitSql(healthSchema)) must(await health.sql.execute("healthlog", statement), "health schema");
    },
    /** Write one Health Log meal the way the Health Log would; returns its row id. */
    async writeHealthMeal(m) {
      const r = must(
        await health.sql.execute(
          "healthlog",
          "INSERT INTO meal (op_id, day, slot, name, kcal, protein_g, carbs_g, fat_g, source, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'app', ?)",
          [m.op_id ?? `op-${randomBytes(6).toString("hex")}`, m.day, m.slot, m.name, m.kcal, m.protein_g ?? 0, m.carbs_g ?? 0, m.fat_g ?? 0, `${m.day}T12:00:00Z`],
        ),
        "write health meal",
      );
      return r.lastInsertRowId;
    },
    async stop() {
      health.close();
      recipes.close();
      await node.stop();
    },
  };
}
