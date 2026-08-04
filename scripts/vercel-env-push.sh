#!/usr/bin/env bash
#
# Push the secrets in a local env file to the linked Vercel project.
#
#   cp .env.vercel.example .env.vercel   # then fill in your values
#   ./scripts/vercel-env-push.sh
#
# Values are read from the file and piped straight to `vercel env add`, so they never appear
# in a shell argument (visible in `ps`), in your shell history, or in a terminal transcript.
# Blank values are skipped, so an unused optional variable can be left empty rather than
# deleted. Existing values are replaced.
#
# Environment variable changes only reach the running app on the next build, so this
# redeploys at the end unless you pass --no-deploy. Use --dry-run to check the file first.

set -euo pipefail

FILE="${ENV_FILE:-.env.vercel}"
TARGETS="${VERCEL_TARGETS:-production preview}"
DEPLOY=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1; DEPLOY=0 ;;
    --no-deploy) DEPLOY=0 ;;
    --file=*)    FILE="${arg#--file=}" ;;
    -h|--help)   sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

if [ ! -f "$FILE" ]; then
  echo "No $FILE found. Copy the template and fill it in:" >&2
  echo "  cp .env.vercel.example $FILE" >&2
  exit 1
fi

if [ ! -d .vercel ]; then
  echo "This directory is not linked to a Vercel project. Run: vercel link" >&2
  exit 1
fi

pushed=0
skipped=0

while IFS= read -r line || [ -n "$line" ]; do
  # Skip blank lines and comments.
  case "$line" in
    ''|'#'*) continue ;;
    *'='*)   ;;
    *)       continue ;;
  esac

  key="${line%%=*}"
  value="${line#*=}"

  # Trim surrounding whitespace from the name, and matched quotes from the value.
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac

  # Reject anything that is not a plausible variable name rather than passing it on.
  case "$key" in
    ''|*[!A-Za-z0-9_]*) echo "skipping malformed line for '$key'" >&2; continue ;;
  esac

  if [ -z "$value" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    # Report the name and the length only. Printing the value would defeat the point of
    # keeping it in a file.
    echo "  would set $key (${#value} chars) → $TARGETS"
    pushed=$((pushed + 1))
    continue
  fi

  for target in $TARGETS; do
    # `vercel env add` refuses to overwrite, so drop any existing value first. A missing
    # one is not an error here.
    vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
    if printf '%s' "$value" | vercel env add "$key" "$target" >/dev/null 2>&1; then
      echo "  set $key ($target)"
    else
      echo "  FAILED to set $key ($target)" >&2
    fi
  done
  pushed=$((pushed + 1))
done < "$FILE"

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "$pushed variable(s) would be pushed, $skipped left blank. Nothing was changed."
  exit 0
fi

echo "$pushed variable(s) pushed, $skipped left blank."

if [ "$DEPLOY" -eq 1 ] && [ "$pushed" -gt 0 ]; then
  echo
  echo "Redeploying so the new values take effect..."
  vercel deploy --prod
else
  echo "Run 'vercel deploy --prod' to apply them."
fi
