---
description: A woodworking shop log kept in SQLite plus project photos in KV.
---

# Working rules

* Costs are integer cents; hours are derived in views, never stored.
* A project is `done` only when `finished_on` is set.
* Photos are KV objects under `photos/`; a `project_photo` row points at the key.
* Another app's price book and catalog are read only: never write to them.
