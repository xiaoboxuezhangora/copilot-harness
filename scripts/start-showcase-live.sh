#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JIRA_ENV_FILE="${JIRA_ENV_FILE:-${ROOT_DIR}/secrets/jira.env}"
GITLAB_ENV_FILE="${GITLAB_ENV_FILE:-${ROOT_DIR}/secrets/gitlab.env}"
SHOWCASE_ENV_FILE="${SHOWCASE_ENV_FILE:-${ROOT_DIR}/secrets/showcase-live.env}"
SHOWCASE_HOST="${SHOWCASE_HOST:-127.0.0.1}"
SHOWCASE_PORT="${SHOWCASE_PORT:-5173}"
MODE="${1:-start}"
DEFAULT_SHOWCASE_JIRA_JQL="project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY updated DESC"

load_env_file() {
  local file_path="$1"
  if [[ -f "${file_path}" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "${file_path}"
    set +a
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env: ${name}" >&2
    return 1
  fi
}

print_runtime_summary() {
  cat <<SUMMARY
Showcase live dev runtime
- host: ${SHOWCASE_HOST}
- port: ${SHOWCASE_PORT}
- jira env: ${JIRA_ENV_FILE}
- gitlab env: ${GITLAB_ENV_FILE}
- showcase env: ${SHOWCASE_ENV_FILE} (optional)
- jira base configured: $([[ -n "${JIRA_BASE_URL:-}" ]] && echo yes || echo no)
- gitlab base configured: $([[ -n "${GITLAB_BASE_URL:-}" ]] && echo yes || echo no)
- jira project allowlist: ${JIRA_PROJECT_ALLOWLIST:-APMIS}
- showcase jira jql: ${SHOWCASE_JIRA_JQL:-${DEFAULT_SHOWCASE_JIRA_JQL}}
- code project: ${CODE_RETRIEVAL_DEFAULT_PROJECT:-APMIS/odcbs/odcbs-frontend}
- code ref: ${CODE_RETRIEVAL_DEFAULT_REF:-develop_to_angular17}
SUMMARY
}

load_env_file "${JIRA_ENV_FILE}"
load_env_file "${GITLAB_ENV_FILE}"
load_env_file "${SHOWCASE_ENV_FILE}"

export JIRA_PROJECT_ALLOWLIST="${JIRA_PROJECT_ALLOWLIST:-APMIS}"
export SHOWCASE_JIRA_JQL="${SHOWCASE_JIRA_JQL:-${DEFAULT_SHOWCASE_JIRA_JQL}}"
export JIRA_SMOKE_JQL="${SHOWCASE_JIRA_JQL}"
export CODE_RETRIEVAL_DEFAULT_PROJECT="${CODE_RETRIEVAL_DEFAULT_PROJECT:-APMIS/odcbs/odcbs-frontend}"
export CODE_RETRIEVAL_DEFAULT_REF="${CODE_RETRIEVAL_DEFAULT_REF:-develop_to_angular17}"
export CODE_RETRIEVAL_REQUEST_TIMEOUT_MS="${CODE_RETRIEVAL_REQUEST_TIMEOUT_MS:-30000}"

missing=0
for env_name in \
  JIRA_BASE_URL \
  JIRA_USERNAME \
  JIRA_API_TOKEN \
  GITLAB_BASE_URL \
  GITLAB_TOKEN; do
  require_env "${env_name}" || missing=1
done

if [[ "${MODE}" == "--check-only" ]]; then
  print_runtime_summary
  if [[ "${missing}" -ne 0 ]]; then
    echo "runtime check failed" >&2
    exit 1
  fi
  echo "runtime check passed"
  exit 0
fi

if [[ "${missing}" -ne 0 ]]; then
  echo "" >&2
  echo "Create local env files before starting:" >&2
  echo "- ${JIRA_ENV_FILE}" >&2
  echo "- ${GITLAB_ENV_FILE}" >&2
  echo "Optional overrides:" >&2
  echo "- ${SHOWCASE_ENV_FILE}" >&2
  exit 1
fi

print_runtime_summary

echo "Starting showcase live dev server: http://${SHOWCASE_HOST}:${SHOWCASE_PORT}/"
exec pnpm --dir "${ROOT_DIR}/apps/showcase" dev --host "${SHOWCASE_HOST}" --port "${SHOWCASE_PORT}"
