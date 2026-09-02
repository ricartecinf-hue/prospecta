#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
cd "${PROJECT_DIR}"

if [[ ! -f .env ]]; then
  echo "Arquivo ${PROJECT_DIR}/.env não encontrado. Copie .env.example e preencha as credenciais." >&2
  exit 1
fi

NODE_BIN="${PROSPECTA_NODE_BIN:-}"
if [[ -z "${NODE_BIN}" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Node.js não encontrado. Defina PROSPECTA_NODE_BIN com o caminho do executável node." >&2
  exit 1
fi
if [[ ! -f node_modules/tsx/dist/cli.mjs ]]; then
  echo "Dependências ausentes. Execute npm install em ${PROJECT_DIR}." >&2
  exit 1
fi

"${PROJECT_DIR}/scripts/start-chrome-macos.sh"
"${NODE_BIN}" node_modules/tsx/dist/cli.mjs src/scripts/preflight.ts
exec "${NODE_BIN}" node_modules/tsx/dist/cli.mjs src/workers/index.ts
