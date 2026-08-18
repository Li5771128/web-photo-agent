ALTER TABLE color_tasks DROP CONSTRAINT IF EXISTS color_tasks_status_check;
ALTER TABLE color_tasks
  ADD CONSTRAINT color_tasks_status_check
  CHECK (status IN ('collecting', 'queued', 'queue_failed', 'measuring', 'measurement_failed', 'recognizing', 'vision_ready', 'vision_failed', 'planning', 'planning_failed', 'validating', 'validation_failed', 'ready', 'cancelled', 'expired'));

CREATE TABLE IF NOT EXISTS image_measurements (
  task_id uuid PRIMARY KEY REFERENCES color_tasks(id) ON DELETE CASCADE,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  reference_result jsonb NOT NULL,
  target_result jsonb NOT NULL,
  comparison_result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
