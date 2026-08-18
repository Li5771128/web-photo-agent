ALTER TABLE color_tasks DROP CONSTRAINT IF EXISTS color_tasks_status_check;
ALTER TABLE color_tasks
  ADD CONSTRAINT color_tasks_status_check
  CHECK (status IN (
    'collecting', 'queued', 'queue_failed', 'measuring', 'measurement_failed',
    'recognizing', 'vision_ready', 'vision_failed', 'planning', 'planning_failed',
    'validating', 'validation_failed', 'ready', 'cancelled', 'expired'
  ));

CREATE TABLE IF NOT EXISTS lightroom_plans (
  task_id uuid PRIMARY KEY REFERENCES color_tasks(id) ON DELETE CASCADE,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  model_name text NOT NULL,
  provider_response_id text,
  prompt_version text NOT NULL,
  validator_version text NOT NULL,
  draft jsonb NOT NULL,
  safe_plan jsonb NOT NULL,
  validation_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now()
);
