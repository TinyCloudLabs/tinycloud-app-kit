// The dev bridge on its own: no node needed. A stand-in node client that fails the test if it is ever
// reached proves the shim refuses these calls itself, before anything leaves the parent.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classifySql, connect } from "../dev/shim.mjs";
import { manifest } from "./lib/env.mjs";

describe("classifySql: the statement class the real bridge must also compute", () => {
  const cls = (sql) => classifySql(sql);

  test("read: one SELECT / VALUES / read-only WITH / EXPLAIN of a read", () => {
    for (const sql of [
      "SELECT 1",
      "  select * from meal where day = ?  ",
      "SELECT * FROM day_card WHERE day = ?;",
      "-- note\nSELECT 1",
      "/* c */ SELECT replace(name, 'a', 'b') FROM meal",
      "SELECT 'a;b' AS x, \"c;d\" FROM meal",
      "SELECT 1 -- ; DROP TABLE meal",
      "VALUES (1), (2)",
      "WITH d AS (SELECT day FROM meal) SELECT * FROM d",
      "EXPLAIN SELECT 1",
      "EXPLAIN QUERY PLAN SELECT * FROM meal",
      "SELECT [weird;name] FROM t",
    ]) assert.equal(cls(sql), "read", sql);
  });

  test("write: one INSERT / UPDATE / DELETE / REPLACE, and WITH ... INSERT|UPDATE|DELETE", () => {
    for (const sql of [
      "INSERT INTO meal (op_id) VALUES (?) ON CONFLICT(op_id) DO NOTHING",
      "UPDATE meal SET kcal = 1 WHERE id = 2",
      "DELETE FROM meal WHERE id = 1;",
      "REPLACE INTO t VALUES (1)",
      "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x",
      "WITH x AS (SELECT 1) DELETE FROM t",
      "WITH x AS (SELECT 1) UPDATE t SET a = 1",
    ]) assert.equal(cls(sql), "write", sql);
  });

  test("schema: one CREATE / DROP / ALTER / REINDEX", () => {
    for (const sql of ["CREATE TABLE t (a)", "create view v as select 1", "DROP TABLE meal", "ALTER TABLE t ADD COLUMN b", "REINDEX"]) {
      assert.equal(cls(sql), "schema", sql);
    }
  });

  test("refused (null): multiple statements, however they are hidden or spaced", () => {
    for (const sql of [
      "SELECT 1; DROP TABLE meal",
      "SELECT 1;SELECT 2",
      "SELECT 1; -- x\n DELETE FROM meal",
      "SELECT 1;;",
      "INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)",
      "SELECT 1 /* a */ ; /* b */ DROP TABLE t",
    ]) assert.equal(cls(sql), null, sql);
  });

  test("refused (null): WITH ... writes or maintenance", () => {
    // as a *query* these are not "read": WITH ... INSERT classifies as write, WITH ... DROP as null
    assert.equal(cls("WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x"), "write");
    assert.equal(cls("WITH x AS (SELECT 1) DROP TABLE t"), null);
    assert.equal(cls("WITH x AS (SELECT 1) CREATE TABLE t (a)"), null);
    assert.equal(cls("WITH x AS (SELECT 1) ATTACH 'f' AS g"), null);
  });

  test("refused (null): load_extension anywhere, PRAGMA, ATTACH, DETACH, VACUUM, transactions, unknown", () => {
    for (const sql of [
      "SELECT load_extension('x')",
      "SELECT LOAD_EXTENSION ('x')",
      "PRAGMA table_info(meal)",
      "pragma writable_schema = 1",
      "ATTACH DATABASE 'x' AS y",
      "DETACH y",
      "VACUUM",
      "VACUUM INTO 'x'",
      "BEGIN",
      "COMMIT",
      "SAVEPOINT a",
      "ANALYZE",
      "EXPLAIN INSERT INTO t VALUES (1)",
      "EXPLAIN DROP TABLE t",
      "EXPLAIN PRAGMA x",
      "",
      "   ",
      "-- only a comment",
      "/* only a comment */",
    ]) assert.equal(cls(sql), null, JSON.stringify(sql));
  });

  test("refused (null): unterminated literals or comments, non-strings", () => {
    for (const sql of ["SELECT 'abc", 'SELECT "abc', "SELECT 1 /* abc", "SELECT [abc", null, undefined, 42, {}]) {
      assert.equal(cls(sql), null, String(sql));
    }
  });

  test("a keyword inside a literal or comment neither hides nor triggers anything", () => {
    assert.equal(cls("SELECT 'DROP TABLE x; PRAGMA y; load_extension' FROM t"), "read");
    assert.equal(cls("/* INSERT */ SELECT 1"), "read");
    assert.equal(cls("INSERT INTO t VALUES ('; DROP TABLE t')"), "write");
  });
});

describe("the bridge refuses before reaching the node, and never throws", () => {
  let reached = 0;
  const tripwire = new Proxy({}, { get: () => { reached += 1; throw new Error("the node client must not be reached"); } });
  let bridge;
  const open = async () => { bridge ??= await connect({ manifest, node: tripwire }); return bridge; };

  const bad = (r, code) => {
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.error.code, code, JSON.stringify(r));
  };

  test("sql.query refuses anything that is not exactly one read statement (the node would run it)", async () => {
    const b = await open();
    for (const sql of [
      "DROP TABLE meal",
      "DELETE FROM meal",
      "INSERT INTO meal (op_id) VALUES ('x')",
      "SELECT 1; DROP TABLE meal",
      "WITH x AS (SELECT 1) INSERT INTO weight (op_id) VALUES ('x')",
      "SELECT load_extension('x')",
      "PRAGMA writable_schema = 1",
      "ATTACH DATABASE 'x' AS y",
      "DETACH y",
      "VACUUM",
      "CREATE TABLE t (a)",
    ]) bad(await b.sql.query("healthlog", sql), "BAD_REQUEST");
    assert.equal(reached, 0);
  });

  test("sql.execute refuses reads, multiple statements and maintenance statements", async () => {
    const b = await open();
    for (const sql of ["SELECT 1", "INSERT INTO t VALUES (1); DROP TABLE t", "PRAGMA x = 1", "VACUUM", "ATTACH 'x' AS y", "WITH x AS (SELECT 1) SELECT * FROM x"]) {
      bad(await b.sql.execute("healthlog", sql), "BAD_REQUEST");
    }
    assert.equal(reached, 0);
  });

  test("circular or odd kv.put options give BAD_REQUEST instead of throwing", async () => {
    const b = await open();
    const circular = {};
    circular.self = circular;
    bad(await b.kv.put("prefs/x", "1", circular), "BAD_REQUEST");
    bad(await b.kv.put("prefs/x", "1", { contentType: 5 }), "BAD_REQUEST");
    bad(await b.kv.put("prefs/x", "1", { ifNoneMatch: "yes" }), "BAD_REQUEST");
    bad(await b.kv.put("prefs/x", "1", { other: 1 }), "BAD_REQUEST");
    bad(await b.kv.put("prefs/x", "1", "text/plain"), "BAD_REQUEST");
    bad(await b.kv.put("prefs/x", "1", []), "BAD_REQUEST");
    const getter = { get contentType() { throw new Error("boom"); } };
    bad(await b.kv.put("prefs/x", "1", getter), "BAD_REQUEST");
    const proxy = new Proxy({}, { ownKeys() { throw new Error("boom"); } });
    bad(await b.kv.put("prefs/x", "1", proxy), "BAD_REQUEST");
    assert.equal(reached, 0);
  });

  test("circular sql params, odd arguments and a throwing argument never throw", async () => {
    const b = await open();
    const circular = [];
    circular.push(circular);
    bad(await b.sql.query("healthlog", "SELECT ?", circular), "BAD_REQUEST");
    bad(await b.sql.query("healthlog", "SELECT ?", [{}]), "BAD_REQUEST");
    bad(await b.sql.query("healthlog", "SELECT ?", null), "BAD_REQUEST");
    bad(await b.sql.query(undefined, "SELECT 1"), "BAD_REQUEST");
    bad(await b.sql.query("healthlog", { toString() { throw new Error("boom"); } }), "BAD_REQUEST");
    bad(await b.kv.get({ toString() { throw new Error("boom"); } }), "BAD_REQUEST");
    bad(await b.kv.get(null), "BAD_REQUEST");
    bad(await b.kv.put("prefs/x", {}), "BAD_REQUEST");
    bad(await b.kv.list(null), "BAD_REQUEST");
    assert.equal(reached, 0);
  });

  test("the manifest decides: no del or list on prefs/, nothing on other prefixes", async () => {
    const b = await open();
    bad(await b.kv.del("prefs/goals.json"), "PERMISSION_DENIED");
    bad(await b.kv.list("prefs/"), "PERMISSION_DENIED");
    bad(await b.kv.list("app/"), "PERMISSION_DENIED");
    bad(await b.kv.list(""), "PERMISSION_DENIED");
    bad(await b.kv.get("secret/x"), "PERMISSION_DENIED");
    assert.equal(reached, 0);
  });
});
