UPDATE prospecta.campaign_config
SET dm_template_1 = E'Oi {{first_name}}, tudo bem? Vi seu perfil e resolvi te enviar esta mensagem.\nNão sei se você já usa algum sistema de gestão para o consultório.\n\nQuero te apresentar o SinaPsi: agenda, prontuário, financeiro, pacientes, IA e gestão clínica trabalhando juntos em um único sistema feito para psicólogos.\n\nSe fizer sentido, posso liberar um acesso gratuito por 10 dias para você conhecer.\nSe não fizer, agradeço sua atenção, peço desculpas pelo incômodo e parabéns pelo seu trabalho.',
    verified_claims = ARRAY(
      SELECT DISTINCT claim
      FROM unnest(verified_claims || ARRAY[
        'Agenda, prontuário, financeiro, pacientes, IA e gestão clínica integrados',
        'Acesso gratuito por 10 dias disponível para apresentação do produto'
      ]) AS claim
    ),
    updated_at = NOW()
WHERE niche = 'psicologo';

INSERT INTO prospecta.audit_log (event, payload)
VALUES ('campaign.sinapsi_first_dm.updated', jsonb_build_object('niche', 'psicologo', 'source', 'migration_015'));
