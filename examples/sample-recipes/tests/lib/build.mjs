// Bundles app.jsx for node tests: JSX -> JS, "@tinycloud/app" -> dev/shim.mjs.
// react / react-dom stay external so the test and the app share one React.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
    alias: { "@tinycloud/app": join(ROOT, "dev/shim.mjs") },
    external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@tinycloud/node-sdk"],
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}
