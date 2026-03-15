#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

EMAIL=""
ENVIRONMENT=""
BINDING="DB"
REMOTE="false"
CLEANUP_ONLY="false"

print_usage() {
  cat <<'EOF'
Usage:
  ./scripts/seed-chats.sh --email <email> [--cleanup] [--remote] [--env production] [--binding DB]

Examples:
  ./scripts/seed-chats.sh --email test@test.com
  ./scripts/seed-chats.sh --email test@test.com --cleanup
  ./scripts/seed-chats.sh --email test@test.com --remote
  ./scripts/seed-chats.sh --email test@test.com --remote --env production
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --env)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --remote)
      REMOTE="true"
      shift
      ;;
    --cleanup)
      CLEANUP_ONLY="true"
      shift
      ;;
    --binding)
      BINDING="${2:-}"
      shift 2
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${EMAIL}" ]]; then
  echo "--email is required" >&2
  print_usage >&2
  exit 1
fi

if [[ -n "${ENVIRONMENT}" && "${REMOTE}" != "true" ]]; then
  echo "--env can only be used together with --remote" >&2
  exit 1
fi

WRANGLER_ARGS=(
  d1 execute
  "${BINDING}"
  --json
  --yes
)

if [[ "${REMOTE}" == "true" ]]; then
  WRANGLER_ARGS+=(--remote)
else
  WRANGLER_ARGS+=(--local)
fi

if [[ -n "${ENVIRONMENT}" ]]; then
  WRANGLER_ARGS+=(--env "${ENVIRONMENT}")
fi

EXECUTE_FILE_ARGS=(
  d1 execute
  "${BINDING}"
  --yes
)

if [[ "${REMOTE}" == "true" ]]; then
  EXECUTE_FILE_ARGS+=(--remote)
else
  EXECUTE_FILE_ARGS+=(--local)
fi

if [[ -n "${ENVIRONMENT}" ]]; then
  EXECUTE_FILE_ARGS+=(--env "${ENVIRONMENT}")
fi

escape_sql() {
  local value="${1//\'/\'\'}"

  printf "%s" "${value}"
}

run_query_to_file() {
  local sql="$1"
  local output_file="$2"

  (
    cd "${ROOT_DIR}"
    pnpm exec wrangler "${WRANGLER_ARGS[@]}" --command "${sql}" > "${output_file}"
  )
}

USER_JSON_FILE="$(mktemp)"
CHAT_ID_JSON_FILE="$(mktemp)"
PROJECT_ID_JSON_FILE="$(mktemp)"
MESSAGE_ID_JSON_FILE="$(mktemp)"
SQL_FILE="$(mktemp "${TMPDIR:-/tmp}/seed-chats.XXXXXX.sql")"

cleanup() {
  rm -f \
    "${USER_JSON_FILE}" \
    "${CHAT_ID_JSON_FILE}" \
    "${PROJECT_ID_JSON_FILE}" \
    "${MESSAGE_ID_JSON_FILE}" \
    "${SQL_FILE}"
}

trap cleanup EXIT

ESCAPED_EMAIL="$(escape_sql "${EMAIL}")"

run_query_to_file \
  "SELECT id, email, name FROM users WHERE email = '${ESCAPED_EMAIL}' LIMIT 1;" \
  "${USER_JSON_FILE}"

USER_JSON="$(
  node "${SCRIPT_DIR}/seed-chats.mjs" \
    resolve-user \
    --input "${USER_JSON_FILE}" \
    --email "${EMAIL}"
)"

USER_ID="$(
  USER_JSON="${USER_JSON}" node --input-type=module <<'EOF'
const user = JSON.parse(process.env.USER_JSON)
process.stdout.write(`${user.id}\n`)
EOF
)"

if [[ "${CLEANUP_ONLY}" == "true" ]]; then
  while IFS= read -r stmt; do
    [[ -z "${stmt}" ]] && continue
    stmt_output="$(
      cd "${ROOT_DIR}"
      pnpm exec wrangler "${WRANGLER_ARGS[@]}" --command "${stmt}" 2>&1
    )" || {
      if echo "${stmt_output}" | grep -q "no such table"; then
        echo "Note: skipped, table does not exist: ${stmt}" >&2
      else
        echo "${stmt_output}" >&2
        exit 1
      fi
    }
  done < <(
    node "${SCRIPT_DIR}/seed-chats.mjs" \
      generate-cleanup-statements \
      --user-id "${USER_ID}"
  )
else
  run_query_to_file \
    "SELECT COALESCE(MAX(id), 0) AS max_id FROM chats;" \
    "${CHAT_ID_JSON_FILE}"
  run_query_to_file \
    "SELECT COALESCE(MAX(id), 0) AS max_id FROM projects;" \
    "${PROJECT_ID_JSON_FILE}"
  run_query_to_file \
    "SELECT COALESCE(MAX(id), 0) AS max_id FROM messages;" \
    "${MESSAGE_ID_JSON_FILE}"

  MAX_CHAT_ID="$(
    node "${SCRIPT_DIR}/seed-chats.mjs" \
      read-max-id \
      --input "${CHAT_ID_JSON_FILE}"
  )"
  MAX_PROJECT_ID="$(
    node "${SCRIPT_DIR}/seed-chats.mjs" \
      read-max-id \
      --input "${PROJECT_ID_JSON_FILE}"
  )"
  MAX_MESSAGE_ID="$(
    node "${SCRIPT_DIR}/seed-chats.mjs" \
      read-max-id \
      --input "${MESSAGE_ID_JSON_FILE}"
  )"

  CHAT_START_ID=$((MAX_CHAT_ID + 1))
  PROJECT_START_ID=$((MAX_PROJECT_ID + 1))
  MESSAGE_START_ID=$((MAX_MESSAGE_ID + 1))

  node "${SCRIPT_DIR}/seed-chats.mjs" \
    generate-sql \
    --email "${EMAIL}" \
    --user-id "${USER_ID}" \
    --chat-start-id "${CHAT_START_ID}" \
    --project-start-id "${PROJECT_START_ID}" \
    --message-start-id "${MESSAGE_START_ID}" \
    > "${SQL_FILE}"

  (
    cd "${ROOT_DIR}"
    pnpm exec wrangler "${EXECUTE_FILE_ARGS[@]}" --file "${SQL_FILE}"
  )
fi

if [[ "${CLEANUP_ONLY}" == "true" ]]; then
  echo "Cleanup complete."
else
  echo "Seed complete."
fi
echo "User ID: ${USER_ID}"
echo "Email: ${EMAIL}"
if [[ "${REMOTE}" != "true" ]]; then
  echo "Environment: local"
elif [[ -n "${ENVIRONMENT}" ]]; then
  echo "Environment: ${ENVIRONMENT}"
else
  echo "Environment: preview/remote"
fi
if [[ "${CLEANUP_ONLY}" != "true" ]]; then
  echo "Chats: 100"
  echo "Projects: 100"
  echo "Project-linked chats: 34"
fi
