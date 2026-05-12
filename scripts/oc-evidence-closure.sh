#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${JIRA_ENV_FILE:-${REPO_ROOT}/secrets/jira.env}"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
fi

if [[ "${1:-}" == "--" ]]; then
  shift
fi

pnpm --dir "${REPO_ROOT}/orchestrator" exec tsx "${REPO_ROOT}/scripts/showcase-evidence-closure.ts" "$@"
