# Prospecta

O Prospecta é um sistema single-tenant que descobre psicólogos e terapeutas no Instagram, qualifica os perfis com GPT-4o-mini, envia DMs por uma sessão real do Chrome, monitora respostas e encaminha leads interessados ao WhatsApp do Ricardo via Evolution API.

O Prospecta não abre nem autentica um navegador. Todos os acessos ao Instagram reutilizam uma aba já aberta no Chrome por CDP. A fila, o rate limit, o intervalo entre mensagens e o circuit breaker ficam no Postgres, portanto continuam válidos mesmo com mais de uma réplica dos workers.

## Requisitos

- Node.js 20.9 ou superior (22 LTS recomendado)
- Postgres/Supabase com o [schema.sql](./schema.sql) aplicado
- Chrome iniciado com remote debugging e Instagram autenticado manualmente
- OpenAI API e uma Evolution API acessível

## Instalação

```bash
npm install
cp .env.example .env
```

Preencha todas as variáveis de `.env`. Para um banco Supabase, mantenha `DATABASE_SSL=true` e `DATABASE_SCHEMA=prospecta`. O schema dedicado mantém as tabelas do Prospecta isoladas de outros sistemas hospedados no mesmo projeto Supabase. As tarifas usadas para estimar o orçamento mensal da OpenAI são configuráveis por ambiente; confira os valores atuais da sua conta antes de produção.

Em uma instalação nova, aplique somente `schema.sql`; ele já inclui as estruturas de segurança e cria tudo dentro do schema `prospecta`. Se uma versão anterior do schema inicial já havia sido aplicada, execute apenas:

```bash
psql "$DATABASE_URL" -f migrations/001_runtime_safety.sql
```

Essa migração adiciona o circuit breaker compartilhado, a reserva global do intervalo entre DMs e o controle de consumo da OpenAI, além de corrigir o contador diário para nunca ultrapassar o máximo.

## Chrome e sessão do Instagram

Inicie manualmente o Chrome com uma porta CDP e um perfil dedicado. No macOS, por exemplo:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.chrome-prospecta"
```

Faça login no Instagram manualmente e deixe uma aba aberta. O Prospecta chama somente `chromium.connectOverCDP(CHROME_CDP_URL)` e reutiliza essa aba. Nunca exponha a porta 9222 à internet; use rede privada, firewall ou túnel. Se a tela de login aparecer, todos os jobs são pausados e um evento `instagram.session_expired` é gravado. Após refazer o login, use “Já fiz login — reativar” no dashboard.

Seletores do Instagram mudam sem aviso. Antes de ativar envios, valide descoberta, leitura de perfil, abertura do Direct e envio com uma conta de teste e baixo volume.

## Execução local

Crie os jobs recorrentes iniciais uma única vez (o comando é idempotente para jobs ativos):

```bash
npm run jobs:seed
```

Execute os dois serviços em terminais separados:

```bash
npm run jobs:start
npm run dev
```

`jobs:start` mantém prospector, qualifier, outreach, follow-up, inbox e handoff no mesmo processo. As ações no Chrome são serializadas internamente para que os workers não disputem a mesma aba.

O dashboard fica em `http://localhost:3000`. Em produção, `DASHBOARD_USER` e `DASHBOARD_PASSWORD` são obrigatórios e protegem tanto as páginas quanto as rotas de configuração.

## Fluxo e garantias

1. O prospector varre diariamente as hashtags e seguidores dos concorrentes configurados, salva novos perfis e cria jobs `qualify`.
2. O qualifier usa exatamente o ICP da campanha e `gpt-4o-mini`. Perfis com score abaixo do mínimo viram `disqualified`.
3. Outreach e follow-up verificam `do_not_contact`, janela de Brasília, teto diário e intervalo aleatório antes do envio.
4. A reserva de DM usa advisory lock e `increment_rate_limit('dm_total', max)`, impedindo que réplicas ultrapassem 30 DMs totais por dia.
5. Três erros consecutivos de envio pausam toda a fila por duas horas. Sessão expirada pausa por 24 horas ou até retomada manual.
6. O inbox roda a cada cinco minutos. “Para”, “não quero”, “sair” e equivalentes marcam opt-out permanente e cancelam outreach/follow-up pendentes.
7. Respostas com intenção explícita criam um handoff para o WhatsApp, com perfil, score e histórico recente.

Toda ação externa (perfil, DM, inbox, OpenAI e WhatsApp) gera eventos antes/depois em `audit_log`. Jobs usam exclusivamente `claim_job()`, baseado em `FOR UPDATE SKIP LOCKED`; após três falhas vão para `dead`.

## Deploy no EasyPanel

O Dockerfile possui exatamente dois targets de serviço, ambos com as mesmas variáveis e a mesma rede privada:

| Serviço | Comando |
|---|---|
| `prospecta-web` | `npm start` |
| `prospecta-jobs` | `npm run jobs:start` |

Para gerar as imagens separadamente:

```bash
docker build --target prospecta-web -t prospecta-web .
docker build --target prospecta-jobs -t prospecta-jobs .
```

Depois do primeiro deploy, abra um console temporário e rode `npm run jobs:seed`. Configure health check HTTP no dashboard (`/dashboard`, aceitando o desafio Basic Auth). Workers não precisam de porta pública.

`CHROME_CDP_URL` deve apontar para o Chrome autenticado acessível na rede privada do EasyPanel; `localhost` só funciona se o Chrome estiver no mesmo container, o que este projeto deliberadamente não inicia. Não publique CDP via domínio público.

## Operação e manutenção

- `/dashboard`: métricas do dia, fila, circuit breaker e auditoria recente.
- `/leads`: filtros por status/nicho e ordenação por score.
- `/leads/[id]`: perfil, justificativa do score e conversa.
- `/config`: ICP, fontes, claims, templates e limites.
- Jobs `dead`: consulte `last_error`, corrija a causa e só então reagende manualmente no banco.
- Auditoria: `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100;`.
- Consumo OpenAI: `SELECT date_trunc('month', created_at), SUM(estimated_cost_usd) FROM ai_usage GROUP BY 1;`.

## Validação

```bash
npm test
npm run typecheck
npm run build
```

Os testes automatizados cobrem regras puras de horário, texto/opt-out e contagens compactas. A integração real com Instagram, Supabase, OpenAI e Evolution API exige as credenciais e a sessão externa; faça um smoke test controlado antes de liberar a campanha.
