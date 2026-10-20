// Minimal YAML subset for OKF frontmatter: block maps, block lists, flow
// lists/maps, plain/single/double-quoted scalars, full-line comments.
// Anchors, tags, multi-line scalars (| and >) and multiple documents are not
// supported and raise an error instead of being guessed at.

export class YamlError extends Error {}

function stripTrailingComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s\[{,:]/.test(text[i - 1])) quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

function plainScalar(text) {
  if (text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (text === "true" || text === "True") return true;
  if (text === "false" || text === "False") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  return text;
}

// Parses a flow value starting at `pos`; returns [value, nextPos].
function parseFlow(text, pos, inFlow) {
  while (text[pos] === " ") pos++;
  const c = text[pos];
  if (c === "[") {
    const out = [];
    pos++;
    for (;;) {
      while (text[pos] === " ") pos++;
      if (text[pos] === "]") return [out, pos + 1];
      const [value, next] = parseFlow(text, pos, true);
      out.push(value);
      pos = next;
      while (text[pos] === " ") pos++;
      if (text[pos] === ",") pos++;
      else if (text[pos] !== "]") throw new YamlError(`expected "," or "]" in flow list: ${text}`);
    }
  }
  if (c === "{") {
    const out = {};
    pos++;
    for (;;) {
      while (text[pos] === " ") pos++;
      if (text[pos] === "}") return [out, pos + 1];
      const [key, afterKey] = parseFlowKey(text, pos);
      pos = afterKey;
      while (text[pos] === " ") pos++;
      if (text[pos] !== ":") throw new YamlError(`expected ":" after key "${key}" in flow map: ${text}`);
      pos++;
      const [value, next] = parseFlow(text, pos, true);
      out[key] = value;
      pos = next;
      while (text[pos] === " ") pos++;
      if (text[pos] === ",") pos++;
      else if (text[pos] !== "}") throw new YamlError(`expected "," or "}" in flow map: ${text}`);
    }
  }
  if (c === '"') {
    let end = pos + 1;
    while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
    if (end >= text.length) throw new YamlError(`unterminated double-quoted string: ${text}`);
    try {
      return [JSON.parse(text.slice(pos, end + 1)), end + 1];
    } catch {
      throw new YamlError(`invalid escape in double-quoted string: ${text}`);
    }
  }
  if (c === "'") {
    let end = pos + 1;
    let value = "";
    for (;;) {
      if (end >= text.length) throw new YamlError(`unterminated single-quoted string: ${text}`);
      if (text[end] === "'") {
        if (text[end + 1] === "'") {
          value += "'";
          end += 2;
          continue;
        }
        return [value, end + 1];
      }
      value += text[end++];
    }
  }
  if (c === "|" || c === ">" || c === "&" || c === "*" || c === "!") {
    throw new YamlError(`unsupported YAML construct "${c}"`);
  }
  let end = pos;
  while (end < text.length) {
    const ch = text[end];
    if (inFlow && (ch === "," || ch === "]" || ch === "}")) break;
    if (inFlow && ch === ":" && (text[end + 1] === " " || end + 1 === text.length)) break;
    end++;
  }
  return [plainScalar(text.slice(pos, end).trim()), end];
}

function parseFlowKey(text, pos) {
  if (text[pos] === '"' || text[pos] === "'") {
    const [value, next] = parseFlow(text, pos, true);
    return [String(value), next];
  }
  let end = pos;
  while (end < text.length && !(text[end] === ":" && (text[end + 1] === " " || end + 1 === text.length))) end++;
  return [text.slice(pos, end).trim(), end];
}

function parseValue(text) {
  const [value, next] = parseFlow(text, 0, false);
  if (text.slice(next).trim() !== "") throw new YamlError(`unexpected text after value: ${text}`);
  return value;
}

const KEY_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:#\-\[{'"][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;

function splitKey(content) {
  const m = KEY_RE.exec(content);
  if (!m) return undefined;
  let key = m[1];
  if (key[0] === '"' || key[0] === "'") key = parseFlow(key, 0, true)[0];
  return { key, rest: m[2] ?? "" };
}

export function parseYaml(src) {
  const lines = [];
  for (const raw of src.split(/\r?\n/)) {
    if (raw.includes("\t") && /^\s*\t/.test(raw)) throw new YamlError("tabs are not allowed for indentation");
    const noComment = stripTrailingComment(raw);
    if (noComment.trim() === "") continue;
    lines.push({ indent: raw.length - raw.trimStart().length, text: noComment.trim() });
  }
  let index = 0;

  function parseBlock(indent) {
    const line = lines[index];
    if (line.text === "-" || line.text.startsWith("- ")) return parseList(indent);
    return parseMap(indent);
  }

  function parseNested(parentIndent) {
    const next = lines[index];
    if (next && next.indent > parentIndent) return parseBlock(next.indent);
    if (next && next.indent === parentIndent && (next.text === "-" || next.text.startsWith("- "))) {
      return parseList(parentIndent);
    }
    return null;
  }

  function parseMap(indent) {
    const out = {};
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new YamlError(`unexpected indentation: ${line.text}`);
      if (line.text === "-" || line.text.startsWith("- ")) break;
      const entry = splitKey(line.text);
      if (!entry) throw new YamlError(`cannot parse line: ${line.text}`);
      index++;
      if (entry.rest === "") out[entry.key] = parseNested(indent);
      else out[entry.key] = parseValue(entry.rest);
    }
    return out;
  }

  function parseList(indent) {
    const out = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new YamlError(`unexpected indentation: ${line.text}`);
      if (!(line.text === "-" || line.text.startsWith("- "))) break;
      const rest = line.text === "-" ? "" : line.text.slice(2).trim();
      if (rest === "") {
        index++;
        out.push(parseNested(indent));
      } else if (!/^[\[{"']/.test(rest) && splitKey(rest)) {
        // "- key: value": a block map whose first entry sits on the dash line.
        lines[index] = { indent: indent + 2, text: rest };
        out.push(parseMap(indent + 2));
      } else {
        index++;
        out.push(parseValue(rest));
      }
    }
    return out;
  }

  if (lines.length === 0) return {};
  const result = parseBlock(lines[0].indent);
  if (index < lines.length) throw new YamlError(`cannot parse line: ${lines[index].text}`);
  return result;
}

/** Splits a markdown file into frontmatter and body. */
export function splitFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!/^---[ \t]*\r?\n/.test(normalized)) return { hasBlock: false, raw: "", body: normalized };
  const lines = normalized.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*\r?$/.test(lines[i])) {
      return {
        hasBlock: true,
        raw: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return { hasBlock: true, unterminated: true, raw: "", body: "" };
}

export function parseFrontmatter(text) {
  const split = splitFrontmatter(text);
  if (!split.hasBlock) return { ...split, data: undefined };
  if (split.unterminated) return { ...split, error: "frontmatter block is not closed with ---" };
  try {
    const data = parseYaml(split.raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { ...split, error: "frontmatter must be a mapping" };
    }
    return { ...split, data };
  } catch (error) {
    return { ...split, error: error.message };
  }
}

// ---- emit -----------------------------------------------------------------

function emitScalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  const safe =
    /^[A-Za-z_][A-Za-z0-9_.\/:@*+-]*$/.test(text) &&
    !/^(true|false|null|yes|no|on|off|y|n)$/i.test(text) &&
    !/:$/.test(text);
  return safe ? text : JSON.stringify(text);
}

function isFlatMap(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).length <= 3 &&
    Object.values(value).every((v) => v === null || typeof v !== "object")
  );
}

function emitInline(value) {
  if (Array.isArray(value)) return `[${value.map(emitInline).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    return `{ ${Object.entries(value)
      .map(([k, v]) => `${emitScalar(k)}: ${emitInline(v)}`)
      .join(", ")} }`;
  }
  return emitScalar(value);
}

export function emitYaml(object, indent = 0) {
  const pad = " ".repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    const k = emitScalar(key);
    if (Array.isArray(value)) {
      if (value.every((v) => v === null || typeof v !== "object")) {
        lines.push(`${pad}${k}: ${emitInline(value)}`);
      } else {
        lines.push(`${pad}${k}:`);
        for (const item of value) {
          if (item !== null && typeof item === "object" && !Array.isArray(item)) {
            const inner = emitYaml(item, indent + 4).split("\n");
            inner[0] = `${pad}  - ${inner[0].trimStart()}`;
            lines.push(...inner);
          } else {
            lines.push(`${pad}  - ${emitInline(item)}`);
          }
        }
      }
    } else if (value !== null && typeof value === "object") {
      if (isFlatMap(value)) lines.push(`${pad}${k}: ${emitInline(value)}`);
      else if (Object.keys(value).length === 0) lines.push(`${pad}${k}: {}`);
      else {
        lines.push(`${pad}${k}:`);
        lines.push(emitYaml(value, indent + 2));
      }
    } else {
      lines.push(`${pad}${k}: ${emitScalar(value)}`);
    }
  }
  return lines.join("\n");
}
