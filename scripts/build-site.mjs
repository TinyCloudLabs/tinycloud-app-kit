// Builds site/ from schemas/*.schema.json. Each schema's own $id is the
// single source of truth for where it gets served — this script just
// resolves $id to a path under site/ and copies the schema there, so the
// published JSON always matches the checked-in schema.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schemasDir = join(root, "schemas");
const siteDir = join(root, "site");
const schemaHost = "schemas.tinycloud.xyz";

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });

const published = [];

for (const entry of readdirSync(schemasDir).sort()) {
  if (!entry.endsWith(".schema.json")) continue;

  const sourcePath = join(schemasDir, entry);
  const raw = readFileSync(sourcePath, "utf8");
  const schema = JSON.parse(raw);

  if (!schema.$id) {
    throw new Error(`${entry} is missing $id; cannot derive a stable publish path`);
  }

  const id = new URL(schema.$id);
  if (id.hostname !== schemaHost) {
    throw new Error(`${entry} $id host is "${id.hostname}", expected "${schemaHost}"`);
  }

  const outPath = join(siteDir, id.pathname);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, raw);

  published.push({ source: entry, path: id.pathname, title: schema.title ?? entry, id: schema.$id });
}

const headerLines = published.flatMap(({ path }) => [path, "  Access-Control-Allow-Origin: *", ""]);
writeFileSync(join(siteDir, "_headers"), headerLines.join("\n"));

const listItems = published
  .map(
    ({ path, title, id, source }) =>
      `      <li><a href="${path}"><code>${path}</code></a> — ${title} <span class="src">(from schemas/${source})</span></li>`
  )
  .join("\n");

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>TinyCloud Schemas</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; color: #111; }
      code { background: #f2f2f2; padding: 0.15em 0.4em; border-radius: 3px; }
      .src { color: #666; font-size: 0.9em; }
      a { color: #0645ad; }
    </style>
  </head>
  <body>
    <h1>TinyCloud Schemas</h1>
    <p>
      Canonical JSON Schemas for TinyCloud app manifests and related formats.
      Source of truth:
      <a href="https://github.com/TinyCloudLabs/tinycloud-app-kit">tinycloud-app-kit</a>.
    </p>
    <ul>
${listItems}
    </ul>
  </body>
</html>
`;
writeFileSync(join(siteDir, "index.html"), indexHtml);

console.log(`build-site: published ${published.length} schema(s) to site/`);
for (const { path, id } of published) {
  console.log(`  ${path}  <-  ${id}`);
}
