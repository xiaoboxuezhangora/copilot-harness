#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${JIRA_ENV_FILE:-${ROOT_DIR}/secrets/jira.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing env file: ${ENV_FILE}" >&2
  echo "copy ${ROOT_DIR}/secrets/jira.env.example to ${ROOT_DIR}/secrets/jira.env and fill credentials" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${ENV_FILE}"

pnpm --dir "${ROOT_DIR}/orchestrator" exec tsx ../scripts/w2-jira-verify.ts
