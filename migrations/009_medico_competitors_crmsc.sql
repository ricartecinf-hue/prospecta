SET search_path TO prospecta, public;

-- ============================================================
-- Nicho médico: troca de concorrentes.
-- @dr.matches saiu (seletor de "seguidores" quebrado — timeout
-- constante ao tentar abrir a lista, ver instagram.ts). Entrou
-- @crm.sc (Conselho Regional de Medicina de SC): quem segue o
-- perfil oficial do conselho é, por definição, médico registrado
-- em SC — a fonte geograficamente mais precisa disponível para
-- o ICP de Florianópolis e região.
-- ============================================================
UPDATE campaign_config
SET icp_competitors = ARRAY['@crm.sc', '@medicinadesucesso', '@dr.financas'],
    updated_at = NOW()
WHERE niche = 'medico';
