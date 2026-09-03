SET search_path TO prospecta, public;

-- ============================================================
-- Reconfiguração do nicho "medico": deixa de ser prospecção para
-- venda de SaaS e passa a ser convite para um evento presencial
-- de vendas e estratégias em Florianópolis e região. ICP, hashtags,
-- concorrentes (perfis que médicos empreendedores seguem) e produto
-- mudam; segue INATIVO até a DM inicial ser escrita.
-- ============================================================
UPDATE campaign_config
SET icp_description = 'Médico(a) com consultório ou clínica própria, perfil ativo no Instagram, entre 1.000 e 100.000 seguidores, localizado em Florianópolis, São José, Palhoça, Biguaçu, Joinville ou Blumenau (confirmado pela bio ou por posts com geolocalização), que posta sobre medicina, procedimentos, o dia a dia do consultório ou vida profissional, com sinais de empreendedorismo (menciona equipe, clínica própria, expansão, gestão).',
    icp_hashtags = ARRAY[
      '#medicodeflorianopolis', '#medicosc', '#medicinasc', '#medicobrasileiro',
      '#clinicamedica', '#consultoriomedico', '#medico', '#florianopolis',
      '#joinville', '#blumenau', '#medicoempreendedor', '#medicosonline'
    ],
    icp_competitors = ARRAY['@dr.matches', '@medicinadesucesso', '@dr.financas'],
    product_name = 'Evento presencial de vendas e estratégias para médicos — Florianópolis',
    product_url = NULL,
    verified_claims = ARRAY[]::text[],
    updated_at = NOW()
WHERE niche = 'medico';
