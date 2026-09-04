SET search_path TO prospecta, public;

UPDATE campaign_config
SET dm_template_1 = 'Oi {{first_name}}, tudo bem? Trabalho com bastante profissional de psicologia e criei o Sinapsi pra resolver um problema que ouço muito: gestão do consultório tomando tempo que deveria ser dos pacientes. Agenda, prontuário e financeiro num só lugar. Dá uma olhada 👇',
    updated_at = NOW()
WHERE niche = 'psicologo';

INSERT INTO audit_log (event, payload)
VALUES ('campaign.sinapsi_first_dm.updated', '{"imagePath":"assets/sinapsi.jpg"}'::jsonb);
