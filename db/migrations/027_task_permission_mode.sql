ALTER TABLE task_queue ADD COLUMN permission_mode TEXT;
ALTER TABLE sessions ADD COLUMN allow_bypass_permissions INTEGER;
