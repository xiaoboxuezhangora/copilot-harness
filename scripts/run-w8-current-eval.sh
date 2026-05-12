#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITLAB_ENV_FILE="${GITLAB_ENV_FILE:-${ROOT_DIR}/secrets/gitlab.env}"

if [[ ! -f "${GITLAB_ENV_FILE}" ]]; then
  echo "missing env file: ${GITLAB_ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${GITLAB_ENV_FILE}"
set +a
export W8_CURRENT_EVAL_REPO_ROOT="${ROOT_DIR}"

pnpm --dir "${ROOT_DIR}/orchestrator" exec tsx "${ROOT_DIR}/scripts/w8-generate-current-eval.ts"
