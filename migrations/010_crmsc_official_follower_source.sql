SET search_path TO prospecta, public;

-- CREMESC é o nome da instituição, mas o perfil oficial publicado no
-- site do Conselho e disponível no Instagram é @crm.sc. Mantemos esse
-- handle canônico e removemos tanto @dr.matches quanto o alias inválido
-- @cremesc das fontes de seguidores.
UPDATE campaign_config
SET icp_competitors = ARRAY['@crm.sc'] || ARRAY(
      SELECT source
      FROM unnest(icp_competitors) AS source
      WHERE lower(source) NOT IN ('@dr.matches', '@cremesc', '@crm.sc')
    ),
    updated_at = NOW()
WHERE niche = 'medico';

UPDATE jobs
SET status = 'done',
    last_error = 'fonte substituída pelo perfil oficial @crm.sc',
    updated_at = NOW()
WHERE kind = 'prospect'
  AND status = 'pending'
  AND payload->>'sourceKind' = 'followers'
  AND lower(payload->>'value') IN ('@dr.matches', '@cremesc');
