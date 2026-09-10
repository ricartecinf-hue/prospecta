BEGIN;

UPDATE prospecta.campaign_config
SET dm_template_followup = 'Oi, {{first_name}}! Passando só pra retomar minha mensagem 😊 Fiquei curioso pra saber como tu organiza hoje essa parte do consultório. Usa algum sistema ou vai fazendo com agenda, planilha e outras ferramentas?',
    followup_after_hours = 3,
    updated_at = NOW()
WHERE niche = 'psicologo';

-- Follow-ups antigos são contados a partir desta mudança para não saírem juntos.
UPDATE prospecta.jobs
SET run_after = NOW() + INTERVAL '3 hours',
    last_error = 'follow-up reagendado para 3h',
    updated_at = NOW()
WHERE kind = 'followup'
  AND status = 'pending';

INSERT INTO prospecta.audit_log (event, payload)
VALUES (
  'campaign.sinapsi_followup.updated',
  jsonb_build_object('niche', 'psicologo', 'hours', 3, 'source', 'migration_020')
);

COMMIT;
