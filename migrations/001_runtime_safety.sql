-- Execute no Supabase para atualizar uma instalação que já recebeu o schema inicial.
BEGIN;

CREATE SCHEMA IF NOT EXISTS prospecta;
SET LOCAL search_path TO prospecta, public, extensions;

CREATE TABLE IF NOT EXISTS agent_state (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO agent_state (key, value) VALUES
  ('circuit_breaker', '{"consecutive_errors":0,"paused_until":null,"reason":null}'),
  ('delivery', '{"next_dm_at":null}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_usage (
  id                 BIGSERIAL PRIMARY KEY,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at DESC);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_external_ref ON conversations(external_ref) WHERE external_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_job(p_kind TEXT DEFAULT NULL)
RETURNS SETOF jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE jobs
  SET status = 'running', attempts = attempts + 1, updated_at = NOW()
  WHERE id = (
    SELECT id FROM jobs
    WHERE status = 'pending'
      AND run_after <= NOW()
      AND attempts < max_attempts
      AND (p_kind IS NULL OR kind = p_kind)
      AND NOT EXISTS (
        SELECT 1 FROM agent_state
        WHERE key = 'circuit_breaker'
          AND NULLIF(value->>'paused_until', '')::timestamptz > NOW()
      )
    ORDER BY run_after ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION increment_rate_limit(p_kind TEXT, p_max INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN := false;
BEGIN
  INSERT INTO rate_limit_counters (date, kind, count)
  VALUES ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date, p_kind, 1)
  ON CONFLICT (date, kind)
  DO UPDATE SET count = rate_limit_counters.count + 1
  WHERE rate_limit_counters.count < LEAST(p_max, 30)
  RETURNING true INTO v_allowed;

  RETURN COALESCE(v_allowed, false);
END;
$$;

COMMIT;
