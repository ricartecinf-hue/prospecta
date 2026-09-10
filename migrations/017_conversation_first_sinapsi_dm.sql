BEGIN;

UPDATE prospecta.campaign_config
SET dm_template_1 = E'Oi {{first_name}}, tudo bem? Vi seu trabalho com psicologia e queria te fazer uma pergunta rápida: hoje você organiza agenda, prontuários e financeiro em um só lugar ou acaba usando ferramentas separadas?\n\nCriei o Sinapsi justamente para reunir essa gestão em um sistema feito para psicólogos. Como você faz por aí?',
    dm_template_followup = 'Oi {{first_name}}, passando só para não deixar minha pergunta perdida: hoje você centraliza agenda, prontuários e financeiro ou ainda usa ferramentas separadas? Se quiser, te mostro o Sinapsi por aqui — sem compromisso.',
    updated_at = NOW()
WHERE niche = 'psicologo';

-- Uma campanha com texto de rascunho não pode permanecer elegível para outreach.
UPDATE prospecta.campaign_config
SET active = false,
    updated_at = NOW()
WHERE niche = 'medico'
  AND dm_template_1 LIKE 'RASCUNHO%';

UPDATE prospecta.jobs AS j
SET status = 'dead',
    last_error = 'campanha médica desativada: mensagem ainda é rascunho',
    updated_at = NOW()
WHERE j.status IN ('pending', 'running')
  AND (
    (j.kind = 'prospect' AND j.payload->>'niche' = 'medico')
    OR (
      j.kind IN ('qualify', 'outreach', 'followup', 'handoff')
      AND EXISTS (
        SELECT 1
        FROM prospecta.leads AS l
        WHERE l.id::text = j.payload->>'leadId'
          AND l.niche = 'medico'
      )
    )
  );

INSERT INTO prospecta.audit_log (event, payload)
VALUES (
  'campaign.sinapsi_dm.conversation_first',
  jsonb_build_object('niche', 'psicologo', 'source', 'migration_017')
);

COMMIT;
