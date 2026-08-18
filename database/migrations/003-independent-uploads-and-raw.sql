ALTER TABLE color_tasks DROP CONSTRAINT IF EXISTS color_tasks_status_check;
ALTER TABLE color_tasks
  ADD CONSTRAINT color_tasks_status_check
  CHECK (status IN ('collecting', 'queued', 'queue_failed', 'measuring', 'measurement_failed', 'recognizing', 'vision_ready', 'vision_failed', 'planning', 'planning_failed', 'validating', 'validation_failed', 'ready', 'cancelled', 'expired'));

ALTER TABLE task_assets ALTER COLUMN width DROP NOT NULL;
ALTER TABLE task_assets ALTER COLUMN height DROP NOT NULL;
ALTER TABLE task_assets ADD COLUMN IF NOT EXISTS is_raw boolean NOT NULL DEFAULT false;
ALTER TABLE task_assets ADD COLUMN IF NOT EXISTS preview_object_key text;

CREATE TABLE IF NOT EXISTS task_upload_slots (
  task_id uuid NOT NULL REFERENCES color_tasks(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('reference', 'target')),
  current_attempt_id uuid,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  status text NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'uploading', 'confirmed', 'failed')),
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, role)
);

ALTER TABLE task_upload_slots ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0;

INSERT INTO task_upload_slots (task_id, role, status)
SELECT t.id, roles.role, CASE WHEN a.id IS NULL THEN 'empty' ELSE 'confirmed' END
FROM color_tasks t
CROSS JOIN (VALUES ('reference'), ('target')) AS roles(role)
LEFT JOIN task_assets a ON a.task_id = t.id AND a.role = roles.role
ON CONFLICT (task_id, role) DO NOTHING;
