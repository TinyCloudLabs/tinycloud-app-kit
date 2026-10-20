// The Health Log sample (../sample-healthlog) owns the bridge shim and the scan rules; this sample reuses
// them rather than keeping copies. The shim imports @tinycloud/node-sdk, which node resolves from the
// shim's own directory, so ../sample-healthlog needs its own `npm install` too (`npm run setup` does both).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SHARED } from "../../dev/build.mjs";

/** undefined when the shared shim can be loaded, else why the tests that need it are skipped. */
export function sharedSkipReason() {
  if (!existsSync(join(SHARED, "dev/shim.mjs"))) return "../sample-healthlog/dev/shim.mjs not found: this sample lives next to the Health Log sample in the kit's examples/";
  if (!existsSync(join(SHARED, "node_modules/@tinycloud/node-sdk"))) return "../sample-healthlog has no node_modules: run `npm install` there too (`npm run setup` here does both)";
  return undefined;
}

/** The shared bridge shim (connect, classifySql, ...). */
export const loadShim = () => import(join(SHARED, "dev/shim.mjs"));
