#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
CHROME_BIN="${CHROME_BINARY:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE_DIR="${PROSPECTA_CHROME_PROFILE_DIR:-${PROJECT_DIR}/.chrome-prospecta}"
CDP_PORT="${PROSPECTA_CHROME_CDP_PORT:-9222}"
CDP_URL="http://127.0.0.1:${CDP_PORT}"
LOG_DIR="${PROJECT_DIR}/.logs"

if /usr/bin/curl --silent --fail --max-time 2 "${CDP_URL}/json/version" >/dev/null 2>&1; then
  echo "Chrome CDP já está ativo em ${CDP_URL}."
  exit 0
fi

if [[ ! -x "${CHROME_BIN}" ]]; then
  echo "Google Chrome não encontrado em ${CHROME_BIN}." >&2
  echo "Defina CHROME_BINARY com o caminho correto." >&2
  exit 1
fi

/bin/mkdir -p "${PROFILE_DIR}" "${LOG_DIR}"
/usr/bin/open -na "Google Chrome" --args \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="${CDP_PORT}" \
  --user-data-dir="${PROFILE_DIR}" \
  --new-window "https://www.instagram.com/" \
  >>"${LOG_DIR}/chrome.log" 2>&1

for attempt in {1..30}; do
  if /usr/bin/curl --silent --fail --max-time 2 "${CDP_URL}/json/version" >/dev/null 2>&1; then
    echo "Chrome dedicado iniciado em ${CDP_URL}."
    echo "Perfil: ${PROFILE_DIR}"
    exit 0
  fi
  /bin/sleep 1
done

echo "Chrome iniciou, mas o CDP não respondeu em ${CDP_URL}. Consulte ${LOG_DIR}/chrome.log." >&2
exit 1
