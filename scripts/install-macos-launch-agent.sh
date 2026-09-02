#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
USER_ID="$(/usr/bin/id -u)"
USER_NAME="$(/usr/bin/id -un)"
USER_DIR="$(/usr/bin/dscl . -read "/Users/${USER_NAME}" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
AGENT_DIR="${USER_DIR}/Library/LaunchAgents"
AGENT_PATH="${AGENT_DIR}/com.prospecta.jobs.plist"
NODE_BIN="$(command -v node || true)"
LOG_DIR="${PROJECT_DIR}/.logs"

if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Node.js não encontrado neste terminal." >&2
  exit 1
fi
if [[ ! -f "${PROJECT_DIR}/.env" ]]; then
  echo "Preencha ${PROJECT_DIR}/.env antes de instalar o início automático." >&2
  exit 1
fi

cd "${PROJECT_DIR}"
"${PROJECT_DIR}/scripts/start-chrome-macos.sh"
"${NODE_BIN}" node_modules/tsx/dist/cli.mjs src/scripts/preflight.ts

/bin/mkdir -p "${AGENT_DIR}" "${LOG_DIR}"
/bin/cat >"${AGENT_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.prospecta.jobs</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${PROJECT_DIR}/scripts/run-jobs-macos.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PROSPECTA_NODE_BIN</key>
    <string>${NODE_BIN}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/jobs.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/jobs.err.log</string>
</dict>
</plist>
PLIST

/bin/chmod 600 "${AGENT_PATH}"
/bin/launchctl bootout "gui/${USER_ID}" "${AGENT_PATH}" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/${USER_ID}" "${AGENT_PATH}"
/bin/launchctl enable "gui/${USER_ID}/com.prospecta.jobs"

echo "Prospecta Jobs instalado para iniciar com seu login no macOS."
echo "Status: launchctl print gui/${USER_ID}/com.prospecta.jobs"
echo "Logs: ${LOG_DIR}/jobs.out.log e ${LOG_DIR}/jobs.err.log"
