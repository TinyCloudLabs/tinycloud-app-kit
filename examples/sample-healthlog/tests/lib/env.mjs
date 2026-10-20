import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../../dev/shim.mjs";
import { ROOT } from "../../dev/build.mjs";
import { startNode } from "./node.mjs";

export const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
export const schemaSql = readFileSync(join(ROOT, "schema.sql"), "utf8");

/** Fresh node + fresh owner + connected bridge. `install()` plays the installer: it copies
 *  the bundle's schema into <app_id>/app/ with the owner's own (installer) authority. */
export async function freshStack() {
  const node = await startNode();
  const bridge = await connect({ manifest, host: node.host, privateKey: randomBytes(32).toString("hex") });
  return {
    node,
    bridge,
    async install() {
      const r = await bridge.node.kv.put(`${manifest.app_id}/app/schema.sql`, schemaSql, { contentType: "text/plain" });
      if (!r.ok) throw new Error(`install failed: ${JSON.stringify(r.error)}`);
    },
    async stop() {
      bridge.close();
      await node.stop();
    },
  };
}
