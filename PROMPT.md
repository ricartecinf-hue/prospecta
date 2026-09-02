# PROSPECTA — Agente de prospecção autônoma no Instagram

## CONFIGURAÇÃO

```
NOME:              Ricardo Pereira
INSTAGRAM:         @oricardo.pereira
WHATSAPP:          [SEU NÚMERO COM DDI — ex: 5511999999999]
SITE:              oricardopereira.com.br

NICHO_ALVO:        Psicólogos e terapeutas brasileiros
PRODUTO:           Sinapsi — sistema de gestão para psicólogos
URL_PRODUTO:       https://sinapsi.qszuuz.easypanel.host
PRECO:             R$67/mês

ICP:
  Psicólogo(a) ou terapeuta com perfil ativo no Instagram
  Entre 500 e 30.000 seguidores
  Posta sobre saúde mental, atendimentos ou dia a dia do consultório
  Localizado no Brasil
  Atende presencial e/ou online
  Não usa sistema de gestão digitalizado (ou usa agenda manual/Excel)

HASHTAGS:
  #psicologa #psicologo #psicologia #psicologaonline
  #terapia #saudemental #consultoriodepsicologia
  #psicoterapia #psicologaclinica #terapeutaonline

CONCORRENTES:
  @psico_manager     (37k seguidores — sistema específico para psicólogos)
  @psicoplanner.app  (11k seguidores — app para psicólogas)
  @ninsaude          (gestão clínica geral, atende psicólogos)

VERIFIED_CLAIMS:
  - Sistema desenvolvido especificamente para psicólogos e terapeutas
  - Gestão de agenda, prontuários e financeiro em um só lugar
  - R$67/mês com suporte incluso
  - Funciona para atendimento presencial e online

UNVERIFIED_CLAIMS (NÃO USAR NAS DMs):
  - Quantidade exata de psicólogos usando
  - Percentual de produtividade ou faturamento
  - Comparações com outros sistemas

DM_1:
  Oi {{first_name}}! Vi seu trabalho aqui no Instagram, muito bonito.
  Desenvolvi o Sinapsi — um sistema de gestão feito especificamente
  para psicólogos: agenda, prontuários e financeiro integrados,
  por R$67/mês. Posso te mostrar como funciona em 5 minutos?

DM_FOLLOWUP (após 48h sem resposta):
  Oi {{first_name}}, tudo bem? Passei aqui de novo — o Sinapsi pode
  facilitar bastante a gestão do seu consultório.
  Sem compromisso, quer dar uma olhada rápida?

WHATSAPP_HANDOFF:  5554981133456

LIMITES:
  Max DMs por dia:      30
  Intervalo entre DMs:  90–240 segundos (aleatório)
  Janela de operação:   09:00–20:00 (horário de Brasília)
  Score mínimo p/ DM:   65
  Follow-up após:       48 horas
```

---

## OBJETIVO

Construir um agente Node.js + TypeScript que:

1. Busca perfis de psicólogos e terapeutas no Instagram via hashtags e seguidores de concorrentes
   usando Playwright conectado via CDP ao Chrome local (porta 9222)

2. Qualifica cada perfil com Google Gemini Flash, gerando score 0–100 com base no ICP

3. Envia a DM_1 para leads com score ≥ 65, respeitando todos os limites operacionais

4. Monitora respostas, identifica interesse e encaminha lead quente para o WhatsApp
   via Evolution API

5. Registra tudo em Postgres (Supabase) usando a fila de jobs com FOR UPDATE SKIP LOCKED

---

## REGRAS QUE NÃO SE NEGOCIAM

**Saúde da conta:**
- Máximo 30 DMs/dia — checar `increment_rate_limit()` antes de cada envio
- Intervalo aleatório entre 90s e 240s entre DMs
- Operar somente entre 09:00 e 20:00 horário de Brasília
- Circuit breaker: 3 erros consecutivos → pausar tudo por 2 horas

**Integridade:**
- NUNCA afirmar algo fora dos VERIFIED_CLAIMS
- NUNCA enviar DM para `do_not_contact = true`
- Opt-out detectado → `do_not_contact = true` imediato e permanente

**Chrome:**
- Sempre conectar via CDP — nunca lançar novo Chrome
- Sessão expirada → pausar jobs e logar, não tentar auto-login

---

## STACK

- Node.js + TypeScript
- Next.js App Router (dashboard)
- Playwright (CDP, porta 9222)
- Postgres — fila nativa com FOR UPDATE SKIP LOCKED (sem Redis/Bull)
- Google Gemini API (Gemini Flash)
- Evolution API (WhatsApp — já rodando no EasyPanel)
- Supabase (banco já existente)
- shadcn/ui + Tailwind (dashboard)

Leia o AGENTS.md para arquitetura completa, ordem de implementação e regras detalhadas.

---

## ENTREGÁVEL

Sistema funcional rodando no EasyPanel com:
- Workers executando o fluxo completo (prospector → qualifier → outreach → handoff)
- Dashboard Next.js com métricas e lista de leads
- Tudo documentado no README.md para operação e manutenção
