-- Track Microsoft (Entra ID) OAuth identity on users, mirroring google_id.
ALTER TABLE users ADD COLUMN microsoft_id TEXT;
CREATE UNIQUE INDEX idx_users_microsoft_id ON users(microsoft_id);
