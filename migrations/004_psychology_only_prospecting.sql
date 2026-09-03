SET search_path TO prospecta, public;

UPDATE campaign_config
SET icp_competitors = array_remove(icp_competitors, '@ninsaude'),
    updated_at = NOW()
WHERE niche = 'psicologo';

UPDATE jobs
SET status = 'done',
    last_error = 'cancelled: fonte ampla de saúde removida da campanha de psicologia',
    updated_at = NOW()
WHERE kind = 'prospect'
  AND status IN ('pending', 'running')
  AND payload->>'sourceKind' = 'followers'
  AND payload->>'value' = '@ninsaude';
