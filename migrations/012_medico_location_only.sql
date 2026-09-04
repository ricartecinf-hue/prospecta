SET search_path TO prospecta, public;

-- Enquanto a campanha médica estiver em validação geográfica, somente as
-- quatro páginas de localização de SC podem alimentar a prospecção.
UPDATE campaign_config
SET icp_hashtags = ARRAY[]::text[],
    icp_competitors = ARRAY[]::text[],
    updated_at = NOW()
WHERE niche = 'medico';

-- Interrompe prospecções médicas antigas por hashtag/seguidores, inclusive
-- jobs já reclamados por um worker. Jobs das quatro localizações permanecem.
UPDATE jobs
SET status = 'done',
    last_error = 'cancelled: campanha médica restrita às localizações de SC',
    updated_at = NOW()
WHERE kind = 'prospect'
  AND status IN ('pending', 'running')
  AND payload->>'niche' = 'medico'
  AND payload->>'sourceKind' <> 'location';

-- Não deixa qualificações ou contatos antigos, originados fora das páginas
-- geográficas, continuarem concorrendo com o lote de validação atual.
UPDATE jobs
SET status = 'done',
    last_error = 'cancelled: origem médica não geográfica',
    updated_at = NOW()
WHERE status IN ('pending', 'running')
  AND kind IN ('qualify', 'outreach', 'followup', 'handoff')
  AND payload->>'leadId' IN (
    SELECT id::text
    FROM leads
    WHERE niche = 'medico'
      AND COALESCE(source, '') NOT LIKE 'location:%'
  );

INSERT INTO audit_log (event, payload)
VALUES (
  'campaign.medico_location_only',
  '{"hashtags":false,"followers":false,"locations":true}'::jsonb
);
