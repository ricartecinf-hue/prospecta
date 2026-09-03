SET search_path TO prospecta, public;

-- ============================================================
-- Segundo nicho: médicos de Florianópolis e região
-- Fica INATIVO até o Ricardo definir o produto e a mensagem de
-- primeira DM (mesmo padrão de proteção que os campos NOT NULL
-- da tabela exigem um valor mesmo antes da campanha valer algo).
-- ============================================================
INSERT INTO campaign_config (
  niche,
  icp_description,
  icp_hashtags,
  icp_competitors,
  product_name,
  product_url,
  verified_claims,
  dm_template_1,
  dm_template_followup,
  whatsapp_number,
  max_dm_per_day,
  min_score_to_dm,
  active
) VALUES (
  'medico',
  'Médico(a) com perfil ativo no Instagram, entre 500 e 50.000 seguidores, localizado em Florianópolis, São José, Palhoça, Biguaçu, Joinville ou Blumenau, que posta sobre medicina, saúde, procedimentos ou o dia a dia do consultório.',
  ARRAY[
    '#medicodeflorianopolis', '#medicosc', '#medicinasc', '#medico',
    '#clinicamedica', '#consultoriomedico', '#medicobrasileiro',
    '#saudesc', '#florianopolis', '#joinville', '#blumenau'
  ],
  ARRAY[]::text[],
  'A definir',
  NULL,
  ARRAY[]::text[],
  'RASCUNHO — não enviar. Defina o produto e a primeira mensagem em /config antes de ativar esta campanha.',
  NULL,
  '5554981133456',
  30,
  65,
  false
)
ON CONFLICT (niche) DO NOTHING;
