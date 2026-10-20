// Bundles app.jsx for node tests: JSX -> JS, "@tinycloud/app" -> the Health Log sample's dev/shim.mjs.
// react / react-dom / recharts stay external so the test and the app share one React.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// One bridge shim for every sample: the Health Log sample owns it.
export const SHARED = resolve(ROOT, "../sample-healthlog");
export const SHIM = join(SHARED, "dev/shim.mjs");

export async function loadApp() {
  const outdir = join(ROOT, ".build");
  mkdirSync(outdir, { recursive: true });
  const outfile = join(outdir, `app-${process.pid}-${Date.now()}.mjs`);
  await build({
    entryPoints: [join(ROOT, "app.jsx")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    alias: { "@tinycloud/app": SHIM },
    external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "recharts", "@tinycloud/node-sdk"],
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}
