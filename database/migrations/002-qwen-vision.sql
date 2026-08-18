ALTER TABLE color_tasks DROP CONSTRAINT IF EXISTS color_tasks_status_check;
ALTER TABLE color_tasks
  ADD CONSTRAINT color_tasks_status_check
  CHECK (status IN ('collecting', 'queued', 'queue_failed', 'recognizing', 'vision_ready', 'vision_failed', 'expired'));

CREATE TABLE IF NOT EXISTS vision_analyses (
  task_id uuid PRIMARY KEY REFERENCES color_tasks(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  provider_response_id text,
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
