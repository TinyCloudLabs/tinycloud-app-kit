// SQLite DDL reader for the OKF generator. It reads CREATE TABLE, CREATE VIEW
// and CREATE INDEX statements: columns, types, constraints, CHECK sets,
// foreign keys, and the comments that sit next to them. Anything else
// (triggers, virtual tables, DML) is reported in `skipped`, never guessed at.

const COLUMN_CONSTRAINT_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "NOT",
  "NULL",
  "DEFAULT",
  "CHECK",
  "REFERENCES",
  "UNIQUE",
  "COLLATE",
  "GENERATED",
  "AS",
]);

export function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const push = (token) => tokens.push(token);

  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      push({ t: "comment", v: src.slice(i + 2, j), start: i, end: j, line, endLine: line });
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const j = close < 0 ? n : close + 2;
      const text = src.slice(i, j);
      const breaks = (text.match(/\n/g) ?? []).length;
      push({
        t: "comment",
        v: text.slice(2, close < 0 ? undefined : -2),
        start: i,
        end: j,
        line,
        endLine: line + breaks,
      });
      line += breaks;
      i = j;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= n) break;
        if (src[j] === c) {
          if (src[j + 1] === c) {
            value += c;
            j += 2;
            continue;
          }
          j++;
          break;
        }
        value += src[j++];
      }
      const breaks = (src.slice(i, j).match(/\n/g) ?? []).length;
      push({ t: c === "'" ? "string" : "ident", v: value, quoted: true, start: i, end: j, line, endLine: line + breaks });
      line += breaks;
      i = j;
      continue;
    }
    if (c === "[") {
      const close = src.indexOf("]", i + 1);
      const j = close < 0 ? n : close + 1;
      push({ t: "ident", v: src.slice(i + 1, close < 0 ? n : close), quoted: true, start: i, end: j, line, endLine: line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxX._]/.test(src[j])) j++;
      push({ t: "number", v: src.slice(i, j), start: i, end: j, line, endLine: line });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const v = src.slice(i, j);
      push({ t: "word", v, u: v.toUpperCase(), start: i, end: j, line, endLine: line });
      i = j;
      continue;
    }
    push({ t: "punct", v: c, start: i, end: i + 1, line, endLine: line });
    i++;
  }
  return tokens;
}

const isCode = (t) => t.t !== "comment";
const isWord = (t, ...words) => t && t.t === "word" && words.includes(t.u);
const isPunct = (t, ch) => t && t.t === "punct" && t.v === ch;
const isName = (t) => t && (t.t === "word" || t.t === "ident");

export function commentText(token) {
  return token.v
    .split("\n")
    .map((l) => l.replace(/^\s*\*+\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** Splits tokens into statements, attaching the comment block just above each. */
function splitStatements(tokens) {
  const statements = [];
  let current = null;
  let pending = [];
  let depth = 0;
  let lastCode = null;
  let trigger = false;

  const finish = () => {
    if (current) statements.push(current);
    current = null;
    depth = 0;
    trigger = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.t === "comment") {
      if (current) current.tokens.push(token);
      else if (lastCode && lastCode.endLine === token.line) {
        // trailing comment of the previous statement: not ours
      } else pending.push(token);
      continue;
    }
    if (!current) {
      if (isPunct(token, ";")) {
        lastCode = token;
        pending = [];
        continue;
      }
      const leading = [];
      let expect = token.line - 1;
      for (let p = pending.length - 1; p >= 0; p--) {
        if (pending[p].endLine !== expect) break;
        leading.unshift(pending[p]);
        expect = pending[p].line - 1;
      }
      pending = [];
      current = { tokens: [], leading };
      trigger = false;
    }
    current.tokens.push(token);
    lastCode = token;
    if (current.tokens.filter(isCode).length <= 4 && isWord(token, "TRIGGER")) trigger = true;
    if (isPunct(token, "(")) depth++;
    else if (isPunct(token, ")")) depth--;
    else if (isPunct(token, ";") && depth <= 0) {
      if (trigger) {
        const code = current.tokens.filter(isCode);
        const prev = code[code.length - 2];
        if (!isWord(prev, "END")) continue;
      }
      finish();
    }
  }
  finish();
  return statements;
}

function matchParen(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i++) {
    if (isPunct(code[i], "(")) depth++;
    else if (isPunct(code[i], ")")) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return code.length - 1;
}

function sliceText(src, tokens) {
  if (tokens.length === 0) return "";
  return collapse(src.slice(tokens[0].start, tokens[tokens.length - 1].end));
}

function splitList(code, from, to) {
  // Splits code[from..to) on commas at depth 0.
  const out = [];
  let depth = 0;
  let item = [];
  for (let i = from; i < to; i++) {
    const t = code[i];
    if (isPunct(t, "(")) depth++;
    if (isPunct(t, ")")) depth--;
    if (isPunct(t, ",") && depth === 0) {
      out.push(item);
      item = [];
    } else item.push(t);
  }
  if (item.length > 0) out.push(item);
  return out;
}

function parseIdentList(tokens) {
  return splitList(tokens, 0, tokens.length)
    .map((item) => item.filter(isName)[0])
    .filter(Boolean)
    .map((t) => t.v);
}

function parseCheck(src, code, from) {
  // code[from] is CHECK; returns {expr, next}.
  const open = code.findIndex((t, i) => i > from && isPunct(t, "("));
  if (open < 0) return { expr: "", next: from + 1 };
  const close = matchParen(code, open);
  return { expr: sliceText(src, code.slice(open + 1, close)), next: close + 1 };
}

function checkSet(expr, column) {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^\\(*\\s*["'\`\\[]?${escaped}["'\`\\]]?\\s+IN\\s*\\(([^()]*)\\)\\s*\\)*$`, "i").exec(expr);
  if (!m) return undefined;
  const values = [...m[1].matchAll(/'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)/g)].map((v) =>
    v[1] !== undefined ? v[1].replace(/''/g, "'") : v[2],
  );
  return values.length > 0 ? values : undefined;
}

function parseReference(src, code, from) {
  // code[from] is REFERENCES.
  let i = from + 1;
  while (isName(code[i]) && isPunct(code[i + 1], ".")) i += 2;
  const table = isName(code[i]) ? code[i].v : undefined;
  i++;
  let columns = [];
  if (isPunct(code[i], "(")) {
    const close = matchParen(code, i);
    columns = parseIdentList(code.slice(i + 1, close));
    i = close + 1;
  }
  const start = i;
  const STOP = new Set(["CONSTRAINT", "PRIMARY", "DEFAULT", "CHECK", "REFERENCES", "UNIQUE", "COLLATE", "GENERATED", "AS"]);
  while (i < code.length) {
    const t = code[i];
    if (t.t === "word") {
      if (STOP.has(t.u)) break;
      if (t.u === "NOT" && !isWord(code[i + 1], "DEFERRABLE")) break;
      if (t.u === "NULL" && !isWord(code[i - 1], "SET")) break;
    }
    i++;
  }
  return { ref: { table, columns, actions: sliceText(src, code.slice(start, i)) }, next: i };
}

function parseColumn(src, item) {
  const code = item.code;
  const column = {
    name: code[0].v,
    type: "",
    primaryKey: false,
    notNull: false,
    unique: false,
    default: undefined,
    checks: [],
    checkSet: undefined,
    references: undefined,
    generated: undefined,
    comment: [...item.leading, ...item.trailing].map(commentText).filter(Boolean).join(" "),
  };
  let i = 1;
  const typeStart = i;
  while (i < code.length) {
    const t = code[i];
    if (t.t === "word" && COLUMN_CONSTRAINT_WORDS.has(t.u)) break;
    if (isPunct(t, "(")) i = matchParen(code, i);
    i++;
  }
  column.type = sliceText(src, code.slice(typeStart, i));
  while (i < code.length) {
    const t = code[i];
    if (isWord(t, "CONSTRAINT")) {
      i += 2;
    } else if (isWord(t, "PRIMARY")) {
      column.primaryKey = true;
      i += 2;
    } else if (isWord(t, "NOT") && isWord(code[i + 1], "NULL")) {
      column.notNull = true;
      i += 2;
    } else if (isWord(t, "NULL")) {
      i++;
    } else if (isWord(t, "UNIQUE")) {
      column.unique = true;
      i++;
    } else if (isWord(t, "DEFAULT")) {
      i++;
      const start = i;
      if (isPunct(code[i], "(")) i = matchParen(code, i) + 1;
      else {
        if (isPunct(code[i], "-") || isPunct(code[i], "+")) i++;
        i++;
      }
      column.default = sliceText(src, code.slice(start, i));
    } else if (isWord(t, "CHECK")) {
      const { expr, next } = parseCheck(src, code, i);
      column.checks.push(expr);
      column.checkSet ??= checkSet(expr, column.name);
      i = next;
    } else if (isWord(t, "REFERENCES")) {
      const { ref, next } = parseReference(src, code, i);
      column.references = ref;
      i = next;
    } else if (isWord(t, "GENERATED") || isWord(t, "AS")) {
      const open = code.findIndex((x, k) => k >= i && isPunct(x, "("));
      if (open >= 0) {
        const close = matchParen(code, open);
        column.generated = sliceText(src, code.slice(open + 1, close));
        i = close + 1;
      } else i++;
    } else {
      i++;
    }
  }
  return column;
}

function parseTableConstraint(src, code) {
  let i = 0;
  if (isWord(code[i], "CONSTRAINT")) i += 2;
  const t = code[i];
  const open = code.findIndex((x, k) => k >= i && isPunct(x, "("));
  if (isWord(t, "PRIMARY")) {
    const close = matchParen(code, open);
    return { kind: "primaryKey", columns: parseIdentList(code.slice(open + 1, close)) };
  }
  if (isWord(t, "UNIQUE")) {
    const close = matchParen(code, open);
    return { kind: "unique", columns: parseIdentList(code.slice(open + 1, close)) };
  }
  if (isWord(t, "CHECK")) {
    return { kind: "check", expr: parseCheck(src, code, i).expr };
  }
  if (isWord(t, "FOREIGN")) {
    const close = matchParen(code, open);
    const refAt = code.findIndex((x, k) => k > close && isWord(x, "REFERENCES"));
    const { ref } = refAt >= 0 ? parseReference(src, code, refAt) : { ref: undefined };
    return { kind: "foreignKey", columns: parseIdentList(code.slice(open + 1, close)), references: ref };
  }
  return { kind: "other", text: sliceText(src, code) };
}

function parseCreateTable(src, statement, code) {
  let i = 1;
  if (isWord(code[i], "TEMP", "TEMPORARY")) i++;
  i++; // TABLE
  if (isWord(code[i], "IF")) i += 3;
  while (isName(code[i]) && isPunct(code[i + 1], ".")) i += 2;
  const name = code[i].v;
  i++;
  if (!isPunct(code[i], "(")) return undefined;
  const close = matchParen(code, i);

  // Group body tokens (comments included) into items.
  const body = statement.tokens.filter((t) => t.start > code[i].start && t.end <= code[close].start);
  const items = [];
  let item = { code: [], leading: [], trailing: [] };
  let pendingLeading = [];
  let lastCode = null;
  let lastItem = null;
  let depth = 0;
  for (const t of body) {
    if (t.t === "comment") {
      if (lastCode && lastCode.endLine === t.line && lastItem) lastItem.trailing.push(t);
      else pendingLeading.push(t);
      continue;
    }
    if (isPunct(t, ",") && depth === 0) {
      lastCode = t;
      lastItem = item;
      items.push(item);
      item = { code: [], leading: [], trailing: [] };
      continue;
    }
    if (isPunct(t, "(")) depth++;
    if (isPunct(t, ")")) depth--;
    if (item.code.length === 0) {
      item.leading.push(...pendingLeading);
      pendingLeading = [];
    }
    item.code.push(t);
    lastCode = t;
    lastItem = item;
  }
  if (item.code.length > 0) items.push(item);
  if (pendingLeading.length > 0 && items.length > 0) items[items.length - 1].trailing.push(...pendingLeading);

  const table = {
    kind: "table",
    name,
    description: statement.leading.map(commentText).filter(Boolean).join(" "),
    columns: [],
    constraints: [],
    options: sliceText(src, code.slice(close + 1).filter((t) => !isPunct(t, ";"))),
  };
  for (const it of items) {
    if (it.code.length === 0) continue;
    const first = it.code[0];
    if (first.t === "word" && ["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"].includes(first.u)) {
      table.constraints.push(parseTableConstraint(src, it.code));
    } else {
      table.columns.push(parseColumn(src, it));
    }
  }
  const pk = table.constraints.find((c) => c.kind === "primaryKey");
  table.primaryKey = pk ? pk.columns : table.columns.filter((c) => c.primaryKey).map((c) => c.name);
  return table;
}

function selectColumns(src, bodyCode) {
  // Output column names of the outermost SELECT, or undefined when any is not
  // spelled out (SELECT *, bare expressions, CTEs).
  if (isWord(bodyCode[0], "WITH")) return undefined;
  const selectAt = bodyCode.findIndex((t) => isWord(t, "SELECT"));
  if (selectAt < 0) return undefined;
  let depth = 0;
  let fromAt = bodyCode.length;
  for (let i = selectAt + 1; i < bodyCode.length; i++) {
    if (isPunct(bodyCode[i], "(")) depth++;
    else if (isPunct(bodyCode[i], ")")) depth--;
    else if (depth === 0 && isWord(bodyCode[i], "FROM")) {
      fromAt = i;
      break;
    }
  }
  let start = selectAt + 1;
  if (isWord(bodyCode[start], "DISTINCT", "ALL")) start++;
  const names = [];
  for (const item of splitList(bodyCode, start, fromAt)) {
    if (item.length === 0) return undefined;
    const last = item[item.length - 1];
    if (isPunct(last, "*")) return undefined;
    const before = item[item.length - 2];
    if (item.length === 1 && isName(last)) names.push(last.v);
    else if (isWord(before, "AS") && isName(last)) names.push(last.v);
    else if (item.length >= 3 && isPunct(before, ".") && isName(last) && item.length === 3) names.push(last.v);
    else if (item.length >= 2 && isName(last) && !isPunct(before, ".") && (isPunct(before, ")") || isName(before) || before.t === "string" || before.t === "number")) {
      names.push(last.v);
    } else return undefined;
  }
  return names.length > 0 ? names : undefined;
}

function parseCreateView(src, statement, code) {
  let i = 1;
  if (isWord(code[i], "TEMP", "TEMPORARY")) i++;
  i++; // VIEW
  if (isWord(code[i], "IF")) i += 3;
  while (isName(code[i]) && isPunct(code[i + 1], ".")) i += 2;
  const name = code[i].v;
  i++;
  let declared;
  if (isPunct(code[i], "(")) {
    const close = matchParen(code, i);
    declared = parseIdentList(code.slice(i + 1, close));
    i = close + 1;
  }
  if (!isWord(code[i], "AS")) return undefined;
  const body = code.slice(i + 1);
  if (isPunct(body[body.length - 1], ";")) body.pop();
  const reads = [];
  for (let k = 0; k < body.length; k++) {
    if (isWord(body[k], "FROM", "JOIN") && isName(body[k + 1])) {
      let m = k + 1;
      while (isName(body[m]) && isPunct(body[m + 1], ".")) m += 2;
      if (isName(body[m])) reads.push(body[m].v);
    }
  }
  const definition = src
    .slice(statement.tokens[0].start, body[body.length - 1].end)
    .trimEnd();
  return {
    kind: "view",
    name,
    description: statement.leading.map(commentText).filter(Boolean).join(" "),
    columns: declared ?? selectColumns(src, body),
    reads,
    definition,
  };
}

function parseCreateIndex(src, statement, code) {
  let i = 1;
  if (isWord(code[i], "UNIQUE")) i++;
  i++; // INDEX
  if (isWord(code[i], "IF")) i += 3;
  while (isName(code[i]) && isPunct(code[i + 1], ".")) i += 2;
  const name = code[i].v;
  i++;
  if (!isWord(code[i], "ON")) return undefined;
  i++;
  const table = code[i].v;
  i++;
  if (!isPunct(code[i], "(")) return undefined;
  const close = matchParen(code, i);
  return {
    kind: "index",
    name,
    table,
    unique: isWord(code[1], "UNIQUE"),
    columns: splitList(code, i + 1, close).map((item) => sliceText(src, item)),
    where: isWord(code[close + 1], "WHERE") ? sliceText(src, code.slice(close + 2).filter((t) => !isPunct(t, ";"))) : undefined,
  };
}

export function parseDdl(src) {
  const result = { tables: [], views: [], indexes: [], skipped: [] };
  for (const statement of splitStatements(tokenize(src))) {
    const code = statement.tokens.filter(isCode);
    if (code.length === 0 || !isWord(code[0], "CREATE")) {
      if (code.length > 0) result.skipped.push(sliceText(src, code).slice(0, 60));
      continue;
    }
    let kindAt = 1;
    if (isWord(code[kindAt], "TEMP", "TEMPORARY")) kindAt++;
    if (isWord(code[kindAt], "UNIQUE")) kindAt++;
    let parsed;
    try {
      if (isWord(code[kindAt], "TABLE")) parsed = parseCreateTable(src, statement, code);
      else if (isWord(code[kindAt], "VIEW")) parsed = parseCreateView(src, statement, code);
      else if (isWord(code[kindAt], "INDEX")) parsed = parseCreateIndex(src, statement, code);
    } catch (error) {
      throw new Error(`cannot parse DDL near "${sliceText(src, code).slice(0, 60)}": ${error.message}`);
    }
    if (!parsed) {
      result.skipped.push(sliceText(src, code).slice(0, 60));
      continue;
    }
    if (parsed.kind === "table") result.tables.push(parsed);
    else if (parsed.kind === "view") result.views.push(parsed);
    else result.indexes.push(parsed);
  }
  const known = new Set([...result.tables, ...result.views].map((o) => o.name.toLowerCase()));
  for (const view of result.views) {
    view.reads = [...new Set(view.reads.filter((n) => known.has(n.toLowerCase())).map((n) => n.toLowerCase()))].map(
      (n) => [...result.tables, ...result.views].find((o) => o.name.toLowerCase() === n).name,
    );
  }
  return result;
}
