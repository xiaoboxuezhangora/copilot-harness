#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DATE_VALUE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date|-d)
      if [[ $# -lt 2 ]]; then
        echo "error: --date requires a value (YYYY-MM-DD)" >&2
        exit 1
      fi
      DATE_VALUE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: bash scripts/oc-showcase-export.sh [--date YYYY-MM-DD]"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${DATE_VALUE}" ]]; then
  pnpm --dir "${REPO_ROOT}/orchestrator" exec tsx "${REPO_ROOT}/scripts/showcase-export.ts" --date "${DATE_VALUE}"
else
  pnpm --dir "${REPO_ROOT}/orchestrator" exec tsx "${REPO_ROOT}/scripts/showcase-export.ts"
fi
