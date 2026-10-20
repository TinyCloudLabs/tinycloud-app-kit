-- Workshop Log: SQLite schema for the shop_log database.
-- Invented for the app-kit golden fixtures; not derived from any real app.

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'planned', 'building', 'finishing', 'done', 'shelved')),
  started_on TEXT,                 -- ISO date the first session happened
  finished_on TEXT,
  budget_cents INTEGER CHECK (budget_cents >= 0),
  notes TEXT
);

-- Hand and power tools the shop owns.
CREATE TABLE IF NOT EXISTS tool (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('hand', 'power', 'measuring', 'clamp', 'other')),
  bought_on TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'needs_service', 'retired')),
  service_every_days INTEGER      -- NULL: no fixed service interval
);

/* Stock the shop keeps: boards, sheets and consumables.
   on_hand is in the material's own unit. */
CREATE TABLE IF NOT EXISTS material (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  species TEXT,
  unit TEXT NOT NULL CHECK (unit IN ('board_ft', 'sheet', 'piece', 'liter', 'kg')),
  on_hand REAL NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reorder_at REAL
);

-- One block of time spent on a project.
CREATE TABLE IF NOT EXISTS work_session (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  worked_on TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  summary TEXT                     -- what got done, one or two lines
);

CREATE INDEX IF NOT EXISTS work_session_by_project ON work_session(project_id, worked_on);

CREATE TABLE IF NOT EXISTS purchase (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES material(id),
  project_id TEXT REFERENCES project(id) ON DELETE SET NULL,
  bought_on TEXT NOT NULL,
  qty REAL NOT NULL CHECK (qty > 0),
  cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'EUR', 'GBP', 'CAD'))
);

CREATE INDEX IF NOT EXISTS purchase_by_material ON purchase(material_id);

-- Parts to cut for a project. A part name is unique within its project.
CREATE TABLE IF NOT EXISTS "cut_item" (
  project_id TEXT NOT NULL,
  part TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  length_mm INTEGER NOT NULL,
  width_mm INTEGER NOT NULL,
  thickness_mm INTEGER NOT NULL,
  material_id TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'cut', 'assembled')),
  area_mm2 INTEGER GENERATED ALWAYS AS (length_mm * width_mm) VIRTUAL,
  PRIMARY KEY (project_id, part),
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES material(id),
  CHECK (length_mm > 0 AND width_mm > 0 AND thickness_mm > 0)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS finish_recipe (
  name TEXT PRIMARY KEY,
  coats INTEGER NOT NULL DEFAULT 1,
  cure_hours REAL,
  steps TEXT NOT NULL              -- JSON array of strings, one per step
);

CREATE TABLE IF NOT EXISTS maintenance_event (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES tool(id),
  done_on TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sharpen', 'lubricate', 'calibrate', 'replace_part')),
  cost_cents INTEGER DEFAULT 0
);

-- A photo of a project; the image bytes are in KV under photos/, at kv_key.
CREATE TABLE IF NOT EXISTS project_photo (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kv_key TEXT NOT NULL,
  taken_on TEXT,
  caption TEXT
);

-- Hours per project, from the work_session rows.
CREATE VIEW IF NOT EXISTS project_hours AS
SELECT p.id AS project_id,
       p.title,
       COALESCE(SUM(s.minutes), 0) / 60.0 AS hours,
       COUNT(s.id) AS sessions
FROM project p LEFT JOIN work_session s ON s.project_id = p.id
GROUP BY p.id;

-- What each project has cost so far, from purchases.
CREATE VIEW IF NOT EXISTS project_spend AS
SELECT p.id AS project_id,
       COALESCE(SUM(u.cost_cents), 0) AS spent_cents,
       p.budget_cents,
       p.budget_cents - COALESCE(SUM(u.cost_cents), 0) AS remaining_cents
FROM project p LEFT JOIN purchase u ON u.project_id = p.id
GROUP BY p.id;

-- One row per project: status, hours and spend together.
CREATE VIEW IF NOT EXISTS project_overview AS
SELECT h.project_id, h.title, p.status, h.hours, h.sessions, s.spent_cents, s.remaining_cents
FROM project_hours h
JOIN project p ON p.id = h.project_id
JOIN project_spend s ON s.project_id = h.project_id;

-- Materials at or under their reorder level.
CREATE VIEW IF NOT EXISTS low_stock AS
SELECT id, name, unit, on_hand, reorder_at
FROM material
WHERE reorder_at IS NOT NULL AND on_hand <= reorder_at;

-- Tools whose last upkeep is older than their service interval (or that never had any).
CREATE VIEW IF NOT EXISTS tool_service_due AS
SELECT t.id AS tool_id,
       t.name,
       MAX(e.done_on) AS last_service,
       t.service_every_days
FROM tool t LEFT JOIN maintenance_event e ON e.tool_id = t.id
WHERE t.status != 'retired' AND t.service_every_days IS NOT NULL
GROUP BY t.id
HAVING last_service IS NULL OR julianday('now') - julianday(last_service) > t.service_every_days;

CREATE VIEW IF NOT EXISTS weekly_hours AS
SELECT strftime('%Y-%W', worked_on) AS week,
       COUNT(*) AS sessions,
       SUM(minutes) / 60.0 AS hours
FROM work_session
GROUP BY week;

-- Cut progress per project: how many parts are in each state.
CREATE VIEW IF NOT EXISTS cut_progress AS
SELECT project_id,
       SUM(CASE WHEN status = 'todo' THEN qty ELSE 0 END) AS todo,
       SUM(CASE WHEN status = 'cut' THEN qty ELSE 0 END) AS cut,
       SUM(CASE WHEN status = 'assembled' THEN qty ELSE 0 END) AS assembled
FROM cut_item
GROUP BY project_id;

-- Monthly spend per material species, using the purchase and material tables.
CREATE VIEW IF NOT EXISTS monthly_species_spend AS
SELECT strftime('%Y-%m', u.bought_on) AS month, m.species, SUM(u.cost_cents) AS cost_cents
FROM purchase u JOIN material m ON m.id = u.material_id
GROUP BY month, m.species;
