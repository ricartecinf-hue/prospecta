SET search_path TO prospecta, public;

UPDATE campaign_config
SET icp_description = replace(
      icp_description,
      'entre 500 e 30000 seguidores',
      'a partir de 500 seguidores'
    ),
    updated_at = NOW()
WHERE niche = 'psicologo';

WITH recalculated AS (
  SELECT l.id,
         CASE
           WHEN l.followers_count IS NULL OR l.followers_count < 500 THEN 0
           WHEN l.followers_count <= 3000 THEN 3
           WHEN l.followers_count <= 5000 THEN 6
           WHEN l.followers_count <= 10000 THEN 9
           WHEN l.followers_count <= 20000 THEN 12
           ELSE 15
         END AS follower_points,
         COALESCE((l.score_breakdown->>'profession_confirmed')::integer, 0) AS profession_points,
         COALESCE((l.score_breakdown->>'mental_health_content')::integer, 0) AS mental_points,
         COALESCE((l.score_breakdown->>'professional_active')::integer, 0) AS active_points,
         COALESCE((l.score_breakdown->>'service_mentioned')::integer, 0) AS service_points,
         NULLIF(l.score_breakdown->>'automatic_block', '') AS automatic_block,
         c.min_score_to_dm
    FROM leads l
    JOIN campaign_config c ON c.niche = l.niche
   WHERE l.score_breakdown IS NOT NULL
), totals AS (
  SELECT *, profession_points + mental_points + follower_points + active_points + service_points AS subtotal
    FROM recalculated
), final AS (
  SELECT *, CASE WHEN automatic_block IS NULL THEN subtotal ELSE LEAST(40, subtotal) END AS final_score
    FROM totals
)
UPDATE leads l
   SET score = f.final_score,
       is_icp = f.profession_points = 35
                AND f.automatic_block IS NULL
                AND f.final_score >= f.min_score_to_dm,
       status = CASE
         WHEN l.status IN ('qualified', 'disqualified')
           THEN CASE WHEN f.profession_points = 35
                          AND f.automatic_block IS NULL
                          AND f.final_score >= f.min_score_to_dm
                     THEN 'qualified' ELSE 'disqualified' END
         ELSE l.status
       END,
       score_breakdown = jsonb_set(
         jsonb_set(l.score_breakdown, '{followers_in_range}', to_jsonb(f.follower_points), true),
         '{subtotal}', to_jsonb(f.subtotal), true
       ),
       score_reason = CASE
         WHEN l.score_reason ~ 'followers_in_range \+[0-9]+'
           THEN regexp_replace(l.score_reason, 'followers_in_range \+[0-9]+', 'followers_in_range +' || f.follower_points)
         WHEN f.follower_points > 0
           THEN LEFT(l.score_reason || ' Seguidores: +' || f.follower_points || '.', 500)
         ELSE l.score_reason
       END,
       updated_at = NOW()
  FROM final f
 WHERE l.id = f.id;

UPDATE jobs j
   SET status = 'done',
       last_error = 'cancelled: lead reprovado após correção da faixa de seguidores',
       updated_at = NOW()
 WHERE j.kind IN ('outreach', 'followup')
   AND j.status = 'pending'
   AND EXISTS (
     SELECT 1 FROM leads l
      WHERE l.id::text = j.payload->>'leadId'
        AND NOT COALESCE(l.is_icp, false)
   );

INSERT INTO jobs (kind, payload)
SELECT 'outreach', jsonb_build_object('leadId', l.id)
 FROM leads l
 WHERE l.is_icp = true
   AND l.status = 'qualified'
   AND l.do_not_contact = false
   AND NOT EXISTS (
     SELECT 1 FROM jobs j
      WHERE j.kind = 'outreach'
        AND j.payload->>'leadId' = l.id::text
        AND j.status IN ('pending', 'running')
   );
