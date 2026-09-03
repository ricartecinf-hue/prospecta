-- ============================================================
-- PROSPECTA — Schema inicial (single tenant)
-- Stack: Postgres (Supabase ou self-hosted no EasyPanel)
-- Migração para multi-tenant: adicionar tenant_id em todas
-- as tabelas e RLS policies — estrutura já preparada para isso
-- ============================================================

-- Isola o Prospecta de outros sistemas que usam o mesmo projeto Supabase.
CREATE SCHEMA IF NOT EXISTS prospecta;
SET search_path TO prospecta, public, extensions;

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- LEADS
-- Perfis encontrados no Instagram, qualificados e trabalhados
-- ============================================================
CREATE TABLE prospecta.leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
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
  niche           TEXT NOT NULL,           -- MVP: 'psicologo'
  score           INTEGER DEFAULT 0,       -- 0–100 via Gemini
  score_reason    TEXT,                    -- explicação do score
  is_icp          BOOLEAN,                 -- decisão estruturada retornada pela IA
  score_breakdown JSONB,                   -- pontos por critério e bloqueio aplicado
  qualified_at    TIMESTAMPTZ,
  
  -- Status no funil
  status          TEXT NOT NULL DEFAULT 'discovered',
  -- discovered → qualified → dm_sent → replied → handed_off → converted | do_not_contact
  
  -- Controle
  do_not_contact  BOOLEAN NOT NULL DEFAULT false,
  source          TEXT,                    -- 'hashtag:#psicologia' | 'followers:@concorrente'
  discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_status    ON prospecta.leads(status);
CREATE INDEX idx_leads_niche     ON prospecta.leads(niche);
CREATE INDEX idx_leads_score     ON prospecta.leads(score DESC);
CREATE INDEX idx_leads_dnc       ON prospecta.leads(do_not_contact);

-- ============================================================
-- CONVERSATIONS
-- Histórico de cada DM trocada com o lead
-- ============================================================
CREATE TABLE prospecta.conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES prospecta.leads(id) ON DELETE CASCADE,
  
  direction   TEXT NOT NULL,               -- 'outbound' | 'inbound'
  channel     TEXT NOT NULL,               -- 'chrome' | 'api_oficial'
  body        TEXT NOT NULL,
  external_ref TEXT,                       -- job id; evita reenvio em retry
  
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at     TIMESTAMPTZ
);

CREATE INDEX idx_conv_lead_id ON prospecta.conversations(lead_id);
CREATE INDEX idx_conv_sent_at ON prospecta.conversations(sent_at DESC);
CREATE UNIQUE INDEX idx_conv_external_ref ON prospecta.conversations(external_ref) WHERE external_ref IS NOT NULL;

-- ============================================================
-- JOBS
-- Fila de trabalho — mesmo padrão comprovado no Sloth
-- FOR UPDATE SKIP LOCKED + retry/backoff + dead-letter
-- ============================================================
CREATE TABLE prospecta.jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  kind         TEXT NOT NULL,
  -- 'prospect'   → buscar novos perfis
  -- 'qualify'    → score via Gemini
  -- 'outreach'   → enviar DM via Chrome
  -- 'followup'   → follow-up agendado
  -- 'inbox_poll' → buscar respostas no Direct a cada 5 minutos
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

CREATE INDEX idx_jobs_pending   ON prospecta.jobs(run_after) WHERE status = 'pending';
CREATE INDEX idx_jobs_status    ON prospecta.jobs(status);
CREATE INDEX idx_jobs_kind      ON prospecta.jobs(kind);

-- ============================================================
-- RATE_LIMIT_COUNTERS
-- Controle diário de DMs enviadas — nunca passar de 30/dia
-- ============================================================
CREATE TABLE prospecta.rate_limit_counters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE TABLE prospecta.campaign_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche             TEXT NOT NULL UNIQUE,   -- MVP: 'psicologo'
  
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
  max_dm_per_day    INTEGER NOT NULL DEFAULT 30 CHECK (max_dm_per_day BETWEEN 1 AND 30),
  window_start_hour INTEGER NOT NULL DEFAULT 9 CHECK (window_start_hour BETWEEN 9 AND 19),
  window_end_hour   INTEGER NOT NULL DEFAULT 20 CHECK (window_end_hour BETWEEN 10 AND 20),
  min_score_to_dm   INTEGER NOT NULL DEFAULT 65,  -- só DM acima desse score
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
CREATE TABLE prospecta.audit_log (
  id         BIGSERIAL PRIMARY KEY,
  event      TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_event      ON prospecta.audit_log(event);
CREATE INDEX idx_audit_created_at ON prospecta.audit_log(created_at DESC);

-- ============================================================
-- AGENT_STATE / AI_USAGE
-- Estado compartilhado entre réplicas e controle de orçamento
-- ============================================================
CREATE TABLE prospecta.agent_state (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO prospecta.agent_state (key, value) VALUES
  ('circuit_breaker', '{"consecutive_errors":0,"paused_until":null,"reason":null}'),
  ('delivery', '{"next_dm_at":null}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE prospecta.ai_usage (
  id                 BIGSERIAL PRIMARY KEY,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_created_at ON prospecta.ai_usage(created_at DESC);

-- ============================================================
-- FUNÇÃO: claim_job
-- Worker chama isso para pegar o próximo job com segurança
-- Evita race condition entre workers — mesmo padrão do Sloth
-- ============================================================
CREATE OR REPLACE FUNCTION prospecta.claim_job(p_kind TEXT DEFAULT NULL)
RETURNS SETOF prospecta.jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE prospecta.jobs
  SET
    status     = 'running',
    attempts   = attempts + 1,
    updated_at = NOW()
  WHERE id = (
    SELECT id FROM prospecta.jobs
    WHERE status    = 'pending'
      AND run_after <= NOW()
      AND attempts < max_attempts
      AND (p_kind IS NULL OR kind = p_kind)
      AND NOT EXISTS (
        SELECT 1 FROM prospecta.agent_state
        WHERE key = 'circuit_breaker'
          AND NULLIF(value->>'paused_until', '')::timestamptz > NOW()
      )
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
CREATE OR REPLACE FUNCTION prospecta.increment_rate_limit(
  p_kind TEXT,
  p_max  INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN := false;
BEGIN
  INSERT INTO prospecta.rate_limit_counters AS counters (date, kind, count)
  VALUES ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date, p_kind, 1)
  ON CONFLICT (date, kind)
  DO UPDATE SET count = counters.count + 1
  WHERE counters.count < LEAST(p_max, 30)
  RETURNING true INTO v_allowed;
  
  RETURN COALESCE(v_allowed, false);
END;
$$;

-- ============================================================
-- SEED: configuração inicial — psicólogos / Sinapsi
-- ============================================================
INSERT INTO prospecta.campaign_config (
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
  ARRAY['@psico_manager', '@psicoplanner.app'],
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
  '5554981133456',
  30,
  65
);
