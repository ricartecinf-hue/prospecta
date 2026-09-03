BEGIN;

SET LOCAL search_path TO prospecta, public, extensions;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_breakdown JSONB;

COMMIT;
