SET search_path TO prospecta, public;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ig_profile_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recent_posts TEXT[] NOT NULL DEFAULT '{}';

UPDATE leads
SET ig_profile_url = 'https://instagram.com/' || ig_username
WHERE ig_profile_url IS NULL OR ig_profile_url = '';

UPDATE leads
SET email = lower((regexp_match(bio, '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', 'i'))[1])
WHERE email IS NULL
  AND bio ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}';

CREATE INDEX IF NOT EXISTS idx_leads_direct_contact
  ON leads ((whatsapp IS NOT NULL OR email IS NOT NULL));

UPDATE campaign_config
SET icp_competitors = ARRAY['@psico_manager', '@psicoplanner.app', '@sinappsy']::text[],
    updated_at = NOW()
WHERE niche = 'psicologo';

INSERT INTO agent_state (key, value)
VALUES ('prospecting_safety', '{"paused_until":null,"reason":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;
