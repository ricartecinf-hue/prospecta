BEGIN;

UPDATE prospecta.campaign_config
SET dm_template_1 = 'Oi, {{first_name}}! Tudo bem? Vi teu perfil e fiquei com uma curiosidade: hoje tu usa algum sistema para organizar teus pacientes, prontuários, agenda e financeiro do consultório? Ou ainda faz isso manualmente ou de outra forma?',
    updated_at = NOW()
WHERE niche = 'psicologo';

INSERT INTO prospecta.audit_log (event, payload)
VALUES (
  'campaign.sinapsi_dm.question_updated',
  jsonb_build_object('niche', 'psicologo', 'source', 'migration_018')
);

COMMIT;
