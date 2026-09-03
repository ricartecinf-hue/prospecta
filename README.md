# Prospecta

O Prospecta é um sistema single-tenant que descobre psicólogos e terapeutas no Instagram, qualifica os perfis com Gemini Flash, envia DMs por uma sessão real do Chrome, monitora respostas e encaminha leads interessados ao WhatsApp do Ricardo via Evolution API.

O Prospecta não abre nem autentica um navegador. Todos os acessos ao Instagram reutilizam uma aba já aberta no Chrome por CDP. A fila, o rate limit, o intervalo entre mensagens e o circuit breaker ficam no Postgres, portanto continuam válidos mesmo com mais de uma réplica dos workers.

## Requisitos

- Node.js 20.9 ou superior (22 LTS recomendado)
- Postgres/Supabase com o [schema.sql](./schema.sql) aplicado
- Chrome iniciado com remote debugging e Instagram autenticado manualmente
- Google Gemini API e uma Evolution API acessível

## Instalação

```bash
npm install
cp .env.example .env
```

Preencha todas as variáveis de `.env`. Para um banco Supabase, mantenha `DATABASE_SSL=true` e `DATABASE_SCHEMA=prospecta`. O schema dedicado mantém as tabelas do Prospecta isoladas de outros sistemas hospedados no mesmo projeto Supabase. O arquivo é ignorado pelo Git e nunca deve ser enviado ao repositório.

O orçamento mensal padrão do Gemini é `US$ 5`. As duas travas de ações externas começam em `false`: `INSTAGRAM_DMS_ENABLED` e `WHATSAPP_HANDOFF_ENABLED`. Enquanto estiverem assim, os respectivos jobs são auditados e reagendados, sem enviar mensagens nem reservar uma vaga no limite diário.

O modelo padrão é `gemini-3.1-flash-lite`, o Flash atual de menor custo para tarefas de alto volume. O `gemini-1.5-flash` não deve ser usado porque seu endpoint foi encerrado pelo Google em 29 de setembro de 2025.

Em uma instalação nova, aplique somente `schema.sql`; ele já inclui as estruturas de segurança e cria tudo dentro do schema `prospecta`. Se uma versão anterior do schema inicial já havia sido aplicada, execute apenas:

```bash
psql "$DATABASE_URL" -f migrations/001_runtime_safety.sql
```

Essa migração adiciona o circuit breaker compartilhado, a reserva global do intervalo entre DMs e o controle de consumo da IA, além de corrigir o contador diário para nunca ultrapassar o máximo.

Quem migrou de OpenAI para Gemini deve aplicar também `migrations/002_requeue_openai_qualifications.sql`; ela libera imediatamente qualificações que o provedor antigo deixou reagendadas no futuro.

## Chrome e sessão do Instagram

No macOS, inicie o Chrome dedicado com:

```bash
npm run jobs:local
```

Na primeira execução, o diagnóstico pedirá que você faça login manualmente no Instagram e deixe uma aba aberta. Rode o mesmo comando outra vez depois do login. O perfil persistente fica em `.chrome-prospecta`, então a sessão será reutilizada após reinícios. O Prospecta chama somente `chromium.connectOverCDP(CHROME_CDP_URL)`; não tenta login automático. A porta CDP fica presa a `127.0.0.1` e nunca deve ser publicada na internet.

Se a tela de login aparecer depois, todos os jobs são pausados e um evento `instagram.session_expired` é gravado. Após refazer o login, use “Já fiz login — reativar” no dashboard.

Seletores do Instagram mudam sem aviso. Antes de ativar envios, valide descoberta, leitura de perfil, abertura do Direct e envio com uma conta de teste e baixo volume.

## Execução local

Com o `.env` preenchido, rode primeiro o diagnóstico somente leitura:

```bash
npm run jobs:check
```

Ele valida as tabelas e campanha do Supabase, o Chrome CDP com uma sessão autenticada do Instagram, a chave e o acesso ao modelo Gemini e a instância da Evolution API. A checagem do Gemini faz uma geração mínima para validar chave, cota e modelo. Nenhum teste envia DM ou WhatsApp.

Crie os jobs recorrentes iniciais uma única vez; o comando é idempotente para jobs ativos:

```bash
npm run jobs:seed
```

Inicie todos os workers, o Chrome dedicado e o preflight com:

```bash
npm run jobs:local
```

`jobs:local` só inicia os workers se o diagnóstico inteiro passar. `jobs:start` continua disponível para ambientes de servidor. Ambos mantêm prospector, qualifier, outreach, follow-up, inbox e handoff no mesmo processo; as ações no Chrome são serializadas internamente.

Depois do smoke test com as travas ligadas, libere uma integração de cada vez no `.env`:

```env
INSTAGRAM_DMS_ENABLED=true
WHATSAPP_HANDOFF_ENABLED=false
```

Reinicie os workers para ler o novo valor. Comece com uma conta de teste e só ative o handoff quando a Evolution API também estiver validada.

### Início automático no macOS

Depois de preencher o `.env`, autenticar o Instagram e obter sucesso em `npm run jobs:check`, instale o agente do usuário:

```bash
npm run jobs:install-macos
```

O `launchd` iniciará o Chrome dedicado e os workers quando Ricardo entrar no macOS, reiniciando o processo se ele cair. O instalador registra o caminho exato do Node atual. Para ver o estado e os logs:

```bash
launchctl print gui/$(id -u)/com.prospecta.jobs
tail -f .logs/jobs.out.log .logs/jobs.err.log
```

Após alterar o `.env`, reinicie o serviço:

```bash
launchctl kickstart -k gui/$(id -u)/com.prospecta.jobs
```

O dashboard fica em `http://localhost:3000`. Em produção, `DASHBOARD_USER` e `DASHBOARD_PASSWORD` são obrigatórios e protegem tanto as páginas quanto as rotas de configuração.

## Fluxo e garantias

1. O prospector varre hashtags e seguidores dos concorrentes configurados, extrai Instagram, WhatsApp e email, salva também os posts recentes e cria jobs `qualify`.
2. Antes de salvar ou consumir Gemini, o prospector exige que a profissão-alvo apareça no nome, bio ou @ e descarta fontes/perfis generalistas de saúde. O qualifier usa exatamente o ICP da campanha e o modelo configurado em `GEMINI_MODEL` (por padrão, `gemini-3.1-flash-lite`). O Gemini identifica sinais objetivos e o código soma pesos fixos: profissão 35, conteúdo de saúde mental 25, audiência até 15, atividade profissional 15 e oferta de atendimento 10. A audiência cresce com os seguidores: abaixo de 500 vale 0, entre 500–3 mil vale 3, entre 3–5 mil vale 6, entre 5–10 mil vale 9, entre 10–20 mil vale 12 e acima de 20 mil vale 15. Perfis pessoais, empresas sem psicólogo identificado e profissões excluídas sem vínculo com psicologia ficam limitados a 40 pontos. Perfis com score abaixo do mínimo viram `disqualified`.
3. Outreach e follow-up verificam `do_not_contact`, janela de Brasília, teto diário e intervalo aleatório antes do envio.
4. A reserva de DM usa advisory lock e `increment_rate_limit('dm_total', max)`, impedindo que réplicas ultrapassem 30 DMs totais por dia.
5. Três erros consecutivos de envio pausam toda a fila por duas horas. Sessão expirada pausa por 24 horas ou até retomada manual.
6. O inbox roda a cada cinco minutos. “Para”, “não quero”, “sair” e equivalentes marcam opt-out permanente e cancelam outreach/follow-up pendentes.
7. Respostas com intenção explícita criam um handoff para o WhatsApp, com perfil, score e histórico recente.
8. A prospecção reserva cada visita no Postgres: no máximo 150 por noite, 30 na última hora e intervalo mínimo de 8 segundos. Pausa entre 02:00–03:00 e 03:41–07:00; HTTP 429 ou captcha acionam pausa auditada de duas horas.

Toda ação externa (perfil, DM, inbox, Gemini e WhatsApp) gera eventos antes/depois em `audit_log`. Jobs usam exclusivamente `claim_job()`, baseado em `FOR UPDATE SKIP LOCKED`; após três falhas vão para `dead`.

## Deploy no EasyPanel

Para o cenário atual, a arquitetura recomendada é híbrida: `prospecta-web` permanece no EasyPanel e `prospecta-jobs` roda no Mac sempre ligado, porque só o Mac possui a sessão real do Instagram. Os dois compartilham o mesmo Supabase. Não é necessário abrir porta no Mac nem expor o Chrome CDP.

O Dockerfile mantém dois targets para permitir uma migração futura dos workers a um host com Chrome privado:

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

Se usar o modo híbrido, pause ou remova o serviço `prospecta-jobs` do EasyPanel para não haver dois consumidores da fila. No serviço web, mantenha apenas as variáveis de banco e autenticação do dashboard. As credenciais do Gemini, Chrome e Evolution pertencem ao `.env` local dos workers.

## Operação e manutenção

- `/dashboard`: métricas do dia, contatos diretos, fila, circuit breaker e auditoria recente.
- `/leads`: filtros por status/nicho, ordenação por score e atalhos para Instagram, WhatsApp e email.
- `/leads/[id]`: todos os dados do perfil, links de contato, justificativa, detalhamento do score e conversa.
- `/config`: ICP, fontes, claims, templates e limites.
- Jobs `dead`: consulte `last_error`, corrija a causa e só então reagende manualmente no banco.
- Auditoria: `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100;`.
- Consumo Gemini: `SELECT date_trunc('month', created_at), model, SUM(estimated_cost_usd) FROM ai_usage GROUP BY 1, 2;`.

## Validação

```bash
npm test
npm run typecheck
npm run build
npm run jobs:check
```

Os testes automatizados cobrem regras puras de horário, texto/opt-out, travas externas e contagens compactas. O último comando é o smoke test de integração e exige as credenciais e a sessão externa; ele não envia mensagens.
