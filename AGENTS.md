# AGENTS.md — Prospecta

## O que é este projeto

Agente de prospecção autônoma no Instagram para Ricardo Pereira (@oricardo.pereira).
O agente busca leads no Instagram por hashtag e seguidores de concorrentes, qualifica
com Google Gemini, envia DM pelo Chrome real (sessão logada), conduz a conversa e encaminha
leads quentes pro WhatsApp.

**Fase atual: single tenant (Ricardo). Multi-tenant vem depois — estruture o código
com `tenant_id` nas interfaces TypeScript mas sem implementar isolamento ainda.**

---

## Stack obrigatória

- **Runtime:** Node.js + TypeScript
- **Framework web:** Next.js (App Router) — mesmo padrão do Zap Love
- **Banco:** Postgres via Supabase (já tem conta) — schema em `schema.sql`
- **Browser automation:** Playwright (headful, conecta no Chrome existente via CDP)
- **IA:** Google Gemini Flash para qualificação
- **Fila de jobs:** Postgres nativo com `FOR UPDATE SKIP LOCKED` — NÃO usar Bull, BullMQ, Redis ou qualquer lib externa de fila
- **Deploy:** EasyPanel (já tem servidor rodando outros sistemas)
- **Cobrança (fase 2):** Asaas — ignorar por enquanto

---

## Arquitetura

```
src/
  app/                    # Next.js App Router (dashboard)
    dashboard/page.tsx    # visão geral dos leads
    leads/page.tsx        # lista e detalhes
    config/page.tsx       # configuração da campanha
  
  workers/                # processos Node.js separados
    prospector.ts         # busca perfis por hashtag/followers
    qualifier.ts          # score via Gemini
    outreach.ts           # envia DM via Chrome
    followup.ts           # re-aborda leads que não responderam
    handoff.ts            # encaminha lead quente pro WhatsApp
  
  lib/
    db.ts                 # cliente Postgres (pg ou postgres.js)
    chrome.ts             # conecta no Chrome via CDP (porta 9222)
    instagram.ts          # ações no Instagram via Playwright
    openai.ts             # qualificação de leads via Gemini (nome mantido por compatibilidade)
    rate-limit.ts         # incrementa contador, retorna boolean
    job-queue.ts          # claim_job(), complete_job(), fail_job()
    whatsapp.ts           # Evolution API (já rodando no EasyPanel)
```

---

## Regras críticas — NÃO violar

### Rate limiting (saúde da conta)
- Máximo **30 DMs por dia** — usar `increment_rate_limit()` do Postgres antes de qualquer envio
- Intervalo entre DMs: **90 a 240 segundos aleatório** — nunca constante
- Janela de operação: **09:00–20:00 horário de Brasília** — checar antes de cada job
- Circuit breaker: se 3 erros consecutivos de envio → pausar TODOS os jobs por 2 horas

### Chrome / sessão Instagram
- Conectar SEMPRE via CDP (`playwright.chromium.connectOverCDP('http://localhost:9222')`)
- Nunca abrir novo Chrome — sempre reusar a sessão existente
- Se a sessão expirar (login page detectada) → pausar jobs, logar no audit_log, não tentar auto-login
- Prospecção: máximo 150 visitas por noite, 30 por hora e intervalo mínimo de 8 segundos por perfil
- Prospecção pausa 02:00–03:00 e 03:41–07:00; HTTP 429 ou captcha pausa por 2 horas

### Fila de jobs
- Usar SEMPRE `claim_job()` do Postgres para pegar jobs — nunca SELECT sem FOR UPDATE
- Job que falha 3x → status = 'dead', salvar last_error, não tentar mais
- Sempre salvar no audit_log antes e depois de cada ação externa (DM, fetch de perfil)

### DM e abordagem
- NUNCA enviar DM para leads com `do_not_contact = true`
- NUNCA inventar claims — usar somente `verified_claims` da `campaign_config`
- Substituir `{{first_name}}` pelo primeiro nome do `full_name` do lead
- Se lead responder "para", "não quero", "sair" ou similar → setar `do_not_contact = true` imediatamente

### Qualificação mínima para enviar DM
- Score mínimo configurável em `campaign_config.min_score_to_dm` (default: 65)
- Leads abaixo do score → status = 'disqualified', não entrar na fila de outreach
- Score estruturado: profissão 35, conteúdo de saúde mental 25, seguidores até 15, perfil ativo 15 e atendimento 10
- Pontos de seguidores: abaixo de 500 = 0; 500–3k = 3; 3–5k = 6; 5–10k = 9; 10–20k = 12; acima de 20k = 15
- Médico, nutricionista, fisioterapeuta, coach sem psicologia, empresa sem psicólogo e perfil pessoal têm teto de 40
- Antes de inserir um lead, o prospector exige psicólogo(a), terapeuta, psicanalista, CRP ou identificador `psi` no nome, bio ou @
- Não usar fontes generalistas de saúde como concorrentes/sementes da campanha de psicologia

---

## Fluxo completo

```
1. prospector.ts
   → busca hashtags/followers via Instagram (Playwright + Chrome)
   → salva perfis novos em leads (status: 'discovered')
   → cria job kind='qualify' para cada lead novo

2. qualifier.ts
   → pega job kind='qualify'
   → manda bio + posts pro Gemini com prompt do nicho
   → salva score e score_reason no lead
   → se score >= min_score_to_dm → cria job kind='outreach'
   → senão → status = 'disqualified'

3. outreach.ts
   → pega job kind='outreach'
   → checa rate limit — se atingido → reagendar job para amanhã 09:00
   → checa janela de horário — se fora → reagendar para próximo horário válido
   → envia DM via Chrome (Playwright CDP)
   → salva em conversations (direction: 'outbound', channel: 'chrome')
   → atualiza lead status = 'dm_sent'
   → cria job kind='followup' com run_after = NOW() + followup_after_hours

4. [polling de respostas — rodar a cada 5 minutos]
   → acessa inbox do Instagram via Chrome
   → para cada resposta de lead com status 'dm_sent':
     → salva em conversations (direction: 'inbound')
     → se opt-out detectado → do_not_contact = true
     → se interesse detectado → cria job kind='handoff'

5. handoff.ts
   → pega job kind='handoff'
   → envia mensagem no WhatsApp do Ricardo via Evolution API
   → payload: nome, @, score, resumo da conversa, link do perfil IG
   → atualiza lead status = 'handed_off'
```

---

## Variáveis de ambiente necessárias

```env
# Postgres
DATABASE_URL=postgresql://...

# Google Gemini
GOOGLE_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_MONTHLY_BUDGET_USD=5

# Chrome CDP
CHROME_CDP_URL=http://localhost:9222

# Evolution API (WhatsApp — já rodando no EasyPanel)
EVOLUTION_API_URL=http://...
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE=...

# Travas externas (manter false até concluir o smoke test)
INSTAGRAM_DMS_ENABLED=false
WHATSAPP_HANDOFF_ENABLED=false

# Fuso horário
TZ=America/Sao_Paulo
```

---

## Prompt de qualificação (Gemini)

Usar este prompt no qualifier.ts:

```
Você é um qualificador de leads para {product_name}.

ICP: {icp_description}

Analise este perfil do Instagram e dê um score de 0 a 100.

Username: {ig_username}
Nome: {full_name}
Bio: {bio}
Seguidores: {followers_count}
Posts: {posts_count}

Responda SOMENTE em JSON:
{
  "score": <0-100>,
  "reason": "<máximo 2 frases explicando o score>",
  "is_icp": <true|false>
}

Score 0–40: claramente fora do ICP
Score 41–64: possível mas incerto
Score 65–84: bom lead
Score 85–100: lead ideal
```

---

## Dashboard (Next.js)

Telas mínimas para o MVP:

1. `/dashboard` — métricas: leads hoje, DMs enviadas, taxa de resposta, leads handed off
2. `/leads` — tabela com filtro por status e nicho, ordenada por score desc
3. `/leads/[id]` — detalhe do lead + histórico de conversas
4. `/config` — editar campaign_config (templates de DM, limites, hashtags)

UI: shadcn/ui + Tailwind — mesmo padrão do Zap Love.

---

## O que NÃO fazer

- NÃO usar Redis, Bull, BullMQ — fila é Postgres puro
- NÃO usar Prisma — SQL direto com `pg` ou `postgres.js`
- NÃO tentar fazer login automático no Instagram
- NÃO ultrapassar 30 DMs/dia sob nenhuma circunstância
- NÃO enviar DM fora da janela 09:00–20:00
- NÃO criar nova janela do Chrome — sempre CDP na porta 9222
- NÃO implementar multi-tenant agora — mas usar tenant_id nas interfaces TS

---

## Ordem de implementação

1. `schema.sql` aplicado no Supabase (já feito)
2. `lib/db.ts` + `lib/job-queue.ts` + `lib/rate-limit.ts`
3. `lib/chrome.ts` + `lib/instagram.ts` (conectar CDP, navegar, ler bio)
4. `workers/qualifier.ts` (Gemini score)
5. `workers/prospector.ts` (busca hashtags)
6. `workers/outreach.ts` (envio de DM)
7. Polling de respostas + `workers/handoff.ts`
8. Dashboard Next.js

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
