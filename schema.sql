-- ============================================================
-- PROSPECTOR — Schema inicial (single tenant)
-- Stack: Postgres (Supabase ou self-hosted no EasyPanel)
-- Migração para multi-tenant: adicionar tenant_id em todas
-- as tabelas e RLS policies — estrutura já preparada para isso
-- ============================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- LEADS
-- Perfis encontrados no Instagram, qualificados e trabalhados
-- ============================================================
CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Identidade do perfil
  ig_username     TEXT NOT NULL UNIQUE,
  ig_user_id      TEXT,
  full_name       TEXT,
  bio             TEXT,
  followers_count INTEGER,
  following_count INTEGER,
  posts_count     INTEGER,
  profile_pic_url TEXT,
  
  -- Qualificação
  niche           TEXT NOT NULL,           -- 'dentista' | 'estetica' | 'psicologa'
  score           INTEGER DEFAULT 0,       -- 0–100 via OpenAI
  score_reason    TEXT,                    -- explicação do score
  qualified_at    TIMESTAMPTZ,
  
  -- Status no funil
  status          TEXT NOT NULL DEFAULT 'discovered',
  -- discovered → qualified → dm_sent → replied → handed_off → converted | do_not_contact
  
  -- Controle
  do_not_contact  BOOLEAN NOT NULL DEFAULT false,
  source          TEXT,                    -- 'hashtag:#dentista' | 'followers:@concorrente'
  discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_status    ON leads(status);
CREATE INDEX idx_leads_niche     ON leads(niche);
CREATE INDEX idx_leads_score     ON leads(score DESC);
CREATE INDEX idx_leads_dnc       ON leads(do_not_contact);

-- ============================================================
-- CONVERSATIONS
-- Histórico de cada DM trocada com o lead
-- ============================================================
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  
  direction   TEXT NOT NULL,               -- 'outbound' | 'inbound'
  channel     TEXT NOT NULL,               -- 'chrome' | 'api_oficial'
  body        TEXT NOT NULL,
  
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at     TIMESTAMPTZ
);

CREATE INDEX idx_conv_lead_id ON conversations(lead_id);
CREATE INDEX idx_conv_sent_at ON conversations(sent_at DESC);

-- ============================================================
-- JOBS
-- Fila de trabalho — mesmo padrão comprovado no Sloth
-- FOR UPDATE SKIP LOCKED + retry/backoff + dead-letter
-- ============================================================
CREATE TABLE jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  kind         TEXT NOT NULL,
  -- 'prospect'   → buscar novos perfis
  -- 'qualify'    → score via OpenAI
  -- 'outreach'   → enviar DM via Chrome
  -- 'followup'   → follow-up agendado
  -- 'handoff'    → encaminhar pro WhatsApp
  
  payload      JSONB NOT NULL DEFAULT '{}',
  
  status       TEXT NOT NULL DEFAULT 'pending',
  -- pending → running → done | failed | dead
  
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error   TEXT,
  
  -- Rate limiting: não executar antes desse momento
  run_after    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_pending   ON jobs(run_after) WHERE status = 'pending';
CREATE INDEX idx_jobs_status    ON jobs(status);
CREATE INDEX idx_jobs_kind      ON jobs(kind);

-- ============================================================
-- RATE_LIMIT_COUNTERS
-- Controle diário de DMs enviadas — nunca passar de 30/dia
-- ============================================================
CREATE TABLE rate_limit_counters (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  kind         TEXT NOT NULL,              -- 'dm_sent' | 'dm_followup'
  count        INTEGER NOT NULL DEFAULT 0,
  
  UNIQUE(date, kind)
);

-- ============================================================
-- CAMPAIGN_CONFIG
-- Configuração da campanha — single row por nicho
-- Estruturada para virar multi-tenant: adicionar tenant_id
-- ============================================================
CREATE TABLE campaign_config (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche             TEXT NOT NULL UNIQUE,   -- 'dentista' | 'estetica' | 'psicologa'
  
  -- ICP (Ideal Customer Profile)
  icp_description   TEXT NOT NULL,
  icp_hashtags      TEXT[] NOT NULL DEFAULT '{}',
  icp_competitors   TEXT[] NOT NULL DEFAULT '{}',  -- @handles dos concorrentes
  
  -- Produto sendo ofertado
  product_name      TEXT NOT NULL,
  product_url       TEXT,
  verified_claims   TEXT[] NOT NULL DEFAULT '{}',   -- só o que pode afirmar
  
  -- Templates de DM
  dm_template_1     TEXT NOT NULL,           -- primeira DM
  dm_template_followup TEXT,                 -- follow-up se não responder
  
  -- Destino do handoff
  whatsapp_number   TEXT NOT NULL,           -- número com DDI: 5511999999999
  
  -- Limites operacionais
  max_dm_per_day    INTEGER NOT NULL DEFAULT 30,
  window_start_hour INTEGER NOT NULL DEFAULT 9,   -- 09:00
  window_end_hour   INTEGER NOT NULL DEFAULT 20,  -- 20:00
  min_score_to_dm   INTEGER NOT NULL DEFAULT 60,  -- só DM acima desse score
  followup_after_hours INTEGER NOT NULL DEFAULT 48,
  
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT_LOG
-- Registro imutável de tudo que o agente fez
-- Essencial para debug e para o circuit breaker
-- ============================================================
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  event      TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_event      ON audit_log(event);
CREATE INDEX idx_audit_created_at ON audit_log(created_at DESC);

-- ============================================================
-- FUNÇÃO: claim_job
-- Worker chama isso para pegar o próximo job com segurança
-- Evita race condition entre workers — mesmo padrão do Sloth
-- ============================================================
CREATE OR REPLACE FUNCTION claim_job(p_kind TEXT DEFAULT NULL)
RETURNS SETOF jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE jobs
  SET
    status     = 'running',
    attempts   = attempts + 1,
    updated_at = NOW()
  WHERE id = (
    SELECT id FROM jobs
    WHERE status    = 'pending'
      AND run_after <= NOW()
      AND (p_kind IS NULL OR kind = p_kind)
    ORDER BY run_after ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- ============================================================
-- FUNÇÃO: increment_rate_limit
-- Retorna false se o limite diário foi atingido
-- ============================================================
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_kind TEXT,
  p_max  INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO rate_limit_counters (date, kind, count)
  VALUES (CURRENT_DATE, p_kind, 1)
  ON CONFLICT (date, kind)
  DO UPDATE SET count = rate_limit_counters.count + 1
  RETURNING count INTO v_count;
  
  RETURN v_count <= p_max;
END;
$$;

-- ============================================================
-- SEED: configuração inicial — psicólogos / Sinapsi
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
  min_score_to_dm
) VALUES (
  'psicologo',
  'Psicólogo(a) ou terapeuta brasileiro(a) com perfil ativo no Instagram, entre 500 e 30000 seguidores, que posta sobre saúde mental, atendimentos ou vida profissional no consultório. Atende de forma presencial ou online.',
  ARRAY[
    '#psicologa', '#psicologo', '#psicologia', '#psicologaonline',
    '#terapia', '#saudemental', '#consultoriodepsicologia',
    '#psicoterapia', '#psicologaclinica', '#terapeutaonline'
  ],
  ARRAY['@exemplo_concorrente_psico'],   -- TROCAR pelo @ real de concorrente do nicho
  'Sinapsi — sistema de gestão para psicólogos',
  'https://sinapsi.qszuuz.easypanel.host',
  ARRAY[
    'Sistema desenvolvido especificamente para psicólogos e terapeutas',
    'Gestão de agenda, prontuários e financeiro em um só lugar',
    'R$67/mês com suporte incluso',
    'Funciona para atendimento presencial e online'
  ],
  'Oi {{first_name}}! Vi seu trabalho aqui no Instagram, muito bonito. Tenho um sistema de gestão feito especificamente para psicólogos — agenda, prontuários e financeiro tudo integrado, por R$67/mês. Posso te mostrar como funciona em 5 minutos?',
  'Oi {{first_name}}, tudo bem? Passei aqui de novo — desenvolvi o Sinapsi pra facilitar a gestão do consultório de psicólogos e acho que pode te ajudar bastante. Sem compromisso, quer dar uma olhada rápida?',
  '5511999999999',   -- TROCAR pelo seu WhatsApp real com DDI
  30,
  65
);
