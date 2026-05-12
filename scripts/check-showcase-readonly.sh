#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOWCASE_DIR="${ROOT_DIR}/apps/showcase"
SHOWCASE_SRC_DIR="${SHOWCASE_DIR}/src"
SHOWCASE_PKG_JSON="${SHOWCASE_DIR}/package.json"

if [[ ! -d "${SHOWCASE_DIR}" ]]; then
  echo "readonly-check: apps/showcase not found"
  exit 1
fi

FAILED=0

run_rule() {
  local rule_name="$1"
  local pattern="$2"
  shift 2
  local targets=("$@")

  if rg -n -e "${pattern}" "${targets[@]}" >/tmp/showcase-readonly-check.out 2>/dev/null; then
    echo "readonly-check: FAILED ${rule_name}"
    cat /tmp/showcase-readonly-check.out
    FAILED=1
  fi
}

# 1) forbid write HTTP methods from fetch options
run_rule \
  "fetch write method" \
  "method\\s*:\\s*['\\\"](POST|PUT|PATCH|DELETE)['\\\"]" \
  "${SHOWCASE_SRC_DIR}"

run_rule \
  "fetch with write verb inline" \
  "fetch\\([^\\n]*(POST|PUT|PATCH|DELETE)" \
  "${SHOWCASE_SRC_DIR}"

# 2) forbid write-style MCP/Jira/GitLab/Notion tool usage in UI
run_rule \
  "write tool keyword in frontend" \
  "(createIssue|updateIssue|deleteIssue|transitionIssue|createMergeRequest|createPullRequest|createPage|updatePage|deletePage|notion.*create|notion.*update|jira.*create|jira.*update|gitlab.*create|gitlab.*update|mcp.*(write|create|update|delete))" \
  "${SHOWCASE_SRC_DIR}"

# 3) forbid server frameworks / server-side runtime entry points in showcase
run_rule \
  "server framework dependency" \
  "\"(express|fastify|koa|hapi|nestjs|pg|mysql2|mongoose|typeorm|prisma|redis|mongodb)\"" \
  "${SHOWCASE_PKG_JSON}"

run_rule \
  "node server api in frontend source" \
  "(http\\.createServer|https\\.createServer|new\\s+PrismaClient|createConnection\\(|MongoClient\\(|Pool\\(|new\\s+Pool\\()" \
  "${SHOWCASE_SRC_DIR}"

# 4) forbid submit forms and submit handlers
run_rule \
  "form tag or submit handler" \
  "(<form\\b|@submit\\b|onSubmit\\b|onsubmit\\b|addEventListener\\(['\\\"]submit['\\\"])" \
  "${SHOWCASE_SRC_DIR}"

if [[ "${FAILED}" -ne 0 ]]; then
  echo "readonly-check: FAILED"
  exit 1
fi

echo "readonly-check: PASS"
