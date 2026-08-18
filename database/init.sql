CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS color_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('collecting', 'queued', 'queue_failed', 'measuring', 'measurement_failed', 'recognizing', 'vision_ready', 'vision_failed', 'planning', 'planning_failed', 'validating', 'validation_failed', 'ready', 'cancelled', 'expired')),
  error_code text,
  worker_received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS color_tasks_session_hash_idx ON color_tasks (session_hash);
CREATE INDEX IF NOT EXISTS color_tasks_expires_at_idx ON color_tasks (expires_at);

CREATE TABLE IF NOT EXISTS task_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES color_tasks(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('reference', 'target')),
  object_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  media_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  width integer CHECK (width > 0),
  height integer CHECK (height > 0),
  is_raw boolean NOT NULL DEFAULT false,
  preview_object_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, role)
);

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

CREATE TABLE IF NOT EXISTS image_measurements (
  task_id uuid PRIMARY KEY REFERENCES color_tasks(id) ON DELETE CASCADE,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  reference_result jsonb NOT NULL,
  target_result jsonb NOT NULL,
  comparison_result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vision_analyses (
  task_id uuid PRIMARY KEY REFERENCES color_tasks(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  provider_response_id text,
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

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
