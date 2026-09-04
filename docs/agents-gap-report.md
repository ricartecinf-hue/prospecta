# Cobertura do AGENTS.md

Auditoria realizada em 4 de setembro de 2026 contra o `AGENTS.md` da raiz.
Status: **implementado**, **parcial** ou **pendente**. Itens adiados
explicitamente pelo próprio AGENTS.md não são tratados como falha.

## Fundação e arquitetura

| Item | Status | Evidência / pendência |
| --- | --- | --- |
| Node.js, TypeScript e Next.js App Router | Implementado | `src/app/` e scripts TypeScript. |
| Postgres/Supabase sem Prisma | Implementado | `src/lib/db.ts`, `schema.sql`, fila SQL. |
| Fila `FOR UPDATE SKIP LOCKED` | Implementado | `claim_job()` chama a função SQL de fila. |
| Playwright via CDP, sem abrir Chrome independente | Implementado | `src/lib/chrome.ts`. |
| Gemini Flash com limite mensal | Implementado | `src/lib/openai.ts` e `ai_usage`. |
| Evolution API | Implementado | `src/lib/whatsapp.ts`; continua bloqueada por ambiente. |
| Interfaces preparadas para `tenant_id` | Parcial | As interfaces têm `tenantId`, mas o banco continua single-tenant, como previsto para esta fase. |
| Cobrança Asaas | Pendente intencional | Fase 2, explicitamente fora do escopo. |

## Segurança e operações

| Item | Status | Evidência / pendência |
| --- | --- | --- |
| Máximo de 30 DMs/dia | Implementado no código; migração pendente no ambiente | Contador corrigido para ser global à conta (`dm_total`), não por nicho. A migração 014 consolida os contadores legados, mas não foi aplicada nesta auditoria porque a conexão de banco configurada não resolveu o host. |
| Intervalo aleatório de 90–240 s | Implementado | `reserveDmSlot()`. |
| Janela 09:00–20:00 | Implementado | Outreach e follow-up validam antes de enviar. |
| Circuit breaker de 3 falhas/2 h | Implementado | Agora a pausa é honrada por toda ação externa, não apenas registrada. |
| Sessão expirada sem auto-login | Implementado | Audita e pausa a automação para login manual. |
| Limites de prospecção por noite/hora/perfil | Implementado | `prospecting-safety.ts`. |
| Auditoria antes/depois de ações externas | Implementado | DM, perfil e WhatsApp registram eventos antes/depois. |

## Fluxo de leads

| Item | Status | Evidência / pendência |
| --- | --- | --- |
| Prospecção, filtro mínimo e jobs de qualificação | Implementado | `prospector.ts`, filtros por nicho e `qualifier.ts`. |
| Score, teto de perfis fora do ICP e mínimo para DM | Implementado | `qualification-score.ts` e `qualifier.ts`. |
| DM, persistência, follow-up e opt-out | Implementado | Outreach/follow-up/inbox; opt-out cancela jobs pendentes. |
| Handoff com nome, @, score, perfil e resumo | Implementado | Mensagem validada em `handoff-handler.ts`; exige `5554981133456` e instância `zaplovecrm`. |
| DM inicial do Sinapsi seguida de imagem | Implementado com pré-requisito local | `outreach-handler.ts` envia texto e anexo; falta fornecer o arquivo real `assets/sinapsi.jpg`. Sem ele o worker falha antes de consumir cota ou enviar texto. |
| Fontes geográficas médicas | Implementado | Quatro `location_id`s e validação de página/cidade. |

## Dashboard e configuração

| Item | Status | Evidência / pendência |
| --- | --- | --- |
| Dashboard de métricas | Implementado | `/dashboard`. |
| Lista e detalhe de leads | Implementado | `/leads` e `/leads/[id]`. |
| Edição de campanha | Implementado | `/config` e API. Agora aceita campanhas somente por localização, sem exigir hashtag. |
| Edição de localizações pelo painel | Implementado | Campo JSON validado para `icp_locations`. |
| shadcn/ui literal | Parcial | Há componentes locais compatíveis com Tailwind, não a dependência shadcn/ui instalada. |

## Testes e entrega

| Item | Status | Evidência / pendência |
| --- | --- | --- |
| Testes de regras e bibliotecas | Implementado | Suite Node cobre filtros, score, limites e texto. |
| Testes de outreach e handoff | Parcial | Handlers injetáveis cobrem bloqueio, janela, limite, idempotência, anexo, erro, payload e destino. O relatório V8 atual mede 100% de linhas no handoff e 98,73% no outreach (apesar de o caso de falha estar exercitado); não há um gate confiável de 100% para os dois workers ainda. |
| Cobertura de integração com Chrome/Evolution | Pendente intencional | Exige sessão Chrome e/ou credenciais; não foi executada nesta auditoria. |
| Deploy EasyPanel reproduzível | Parcial | Existe `Dockerfile`, mas não há manifesto/documentação operacional específica do EasyPanel. |
| Asset aprovado do Sinapsi | Pendente | O caminho foi padronizado, porém o JPEG não está versionado no repositório. |
