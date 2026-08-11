-- Company (organization) device library: custom templates shared by every
-- authenticated user of this API instance. Stored as full DeviceTemplate JSON
-- blobs — unlike the columnar community `templates` table, these need no
-- search/filter surface, only sync. Rows are tombstoned (deleted=1) rather
-- than removed so offline clients learn about deletions on their next pull.
CREATE TABLE org_templates (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_org_templates_updated_at ON org_templates(updated_at);
