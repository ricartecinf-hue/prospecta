SET search_path TO prospecta, public;

ALTER TABLE campaign_config
  ADD COLUMN IF NOT EXISTS icp_locations JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE campaign_config
SET icp_description = 'Médico(a) com consultório ou clínica própria, perfil ativo no Instagram, entre 1.000 e 100.000 seguidores. É obrigatório que a bio ou os posts mencionem explicitamente Florianópolis, São José, Palhoça, Biguaçu, Joinville ou Blumenau; sem uma dessas cidades o lead não pertence ao ICP.',
    icp_hashtags = ARRAY[]::text[],
    icp_competitors = ARRAY['@crm.sc'],
    icp_locations = '[
      {"id":"109351455749641","name":"Florianópolis"},
      {"id":"109342319085733","name":"São José SC"},
      {"id":"107478147335563","name":"Joinville SC"},
      {"id":"1978400505720839","name":"Blumenau SC"}
    ]'::jsonb,
    updated_at = NOW()
WHERE niche = 'medico';

UPDATE jobs
SET status = 'done',
    last_error = 'fonte médica substituída por @crm.sc e localizações de SC',
    updated_at = NOW()
WHERE kind = 'prospect'
  AND status = 'pending'
  AND payload->>'niche' = 'medico'
  AND NOT (
    (payload->>'sourceKind' = 'followers' AND lower(payload->>'value') = '@crm.sc')
    OR (
      payload->>'sourceKind' = 'location'
      AND payload->>'value' IN (
        '109351455749641',
        '109342319085733',
        '107478147335563',
        '1978400505720839'
      )
    )
  );

-- O gate geográfico já é determinístico no scorer. Corrigimos também leads
-- antigos que permaneceram qualificados sem pontos de localização e retiramos
-- qualquer outreach/follow-up que ainda estivesse aguardando execução.
UPDATE leads
SET is_icp = false,
    status = CASE WHEN status IN ('discovered', 'qualified') THEN 'disqualified' ELSE status END,
    updated_at = NOW()
WHERE niche = 'medico'
  AND COALESCE((score_breakdown->>'location_confirmed')::int, 0) = 0;

UPDATE jobs
SET status = 'done',
    last_error = 'cancelled: localização obrigatória não confirmada',
    updated_at = NOW()
WHERE kind IN ('outreach', 'followup')
  AND status = 'pending'
  AND payload->>'leadId' IN (
    SELECT id::text FROM leads WHERE niche = 'medico' AND is_icp = false
  );
