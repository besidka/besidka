#!/usr/bin/env bash

# Clean up GitHub Actions workflow runs by title pattern
# Usage: ./scripts/clean-gh-runs.sh [--limit N] [--yes] [pattern1] [pattern2] ...

set -e

# Default patterns if none provided
DEFAULT_PATTERNS=(
  "chore(deps-dev): bump"
  "chore(deps): bump"
  "npm_and_yarn"
)

# Parse arguments
LIMIT=200
AUTO_YES=false
PATTERNS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    -y|--yes)
      AUTO_YES=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--limit N] [--yes] [pattern1] [pattern2] ..."
      echo ""
      echo "Options:"
      echo "  --limit N    Fetch up to N recent runs (default: 200)"
      echo "  -y, --yes    Skip confirmation prompt"
      echo "  -h, --help   Show this help message"
      echo ""
      echo "Default patterns:"
      printf '  - "%s"\n' "${DEFAULT_PATTERNS[@]}"
      echo ""
      echo "Examples:"
      echo "  $0                                    # Use default patterns"
      echo "  $0 --yes                              # Auto-confirm deletion"
      echo "  $0 'chore(deps)' 'build:'             # Custom patterns"
      exit 0
      ;;
    *)
      PATTERNS+=("$1")
      shift
      ;;
  esac
done

# Use default patterns if none provided
if [ ${#PATTERNS[@]} -eq 0 ]; then
  PATTERNS=("${DEFAULT_PATTERNS[@]}")
fi

echo "🔍 Searching for workflow runs matching patterns..."
printf '   - "%s"\n' "${PATTERNS[@]}"
echo ""

# Build jq filter for multiple patterns
JQ_FILTER='.[] | select('
for i in "${!PATTERNS[@]}"; do
  if [ $i -gt 0 ]; then
    JQ_FILTER+=" or "
  fi
  JQ_FILTER+=".displayTitle | contains(\"${PATTERNS[$i]}\")"
done
JQ_FILTER+=')'

# Fetch and filter runs
set +e
RUN_IDS=$(gh run list --limit "$LIMIT" --json databaseId,displayTitle 2>/dev/null | \
  jq -r "$JQ_FILTER | .databaseId" 2>/dev/null)
JQ_EXIT=$?
set -e

if [ $JQ_EXIT -ne 0 ] || [ -z "$RUN_IDS" ]; then
  echo "✅ No matching workflow runs found."
  exit 0
fi

# Count runs
RUN_COUNT=$(echo "$RUN_IDS" | wc -l | tr -d ' ')

echo "📋 Found $RUN_COUNT matching workflow run(s):"
echo ""

# Show preview of runs to be deleted
gh run list --limit "$LIMIT" --json databaseId,displayTitle,status,conclusion | \
  jq -r "$JQ_FILTER | \"  [\(.databaseId)] \(.displayTitle) (\(.status)/\(.conclusion // \"pending\"))\"" | \
  head -20

if [ "$RUN_COUNT" -gt 20 ]; then
  echo "  ... and $((RUN_COUNT - 20)) more"
fi

echo ""

# Confirm deletion
if [ "$AUTO_YES" = false ]; then
  read -p "❓ Delete these $RUN_COUNT run(s)? [y/N] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled."
    exit 1
  fi
fi

# Delete runs
echo ""
echo "🗑️  Deleting workflow runs..."
DELETED=0
FAILED=0

while IFS= read -r id; do
  if echo "y" | gh run delete "$id" &>/dev/null; then
    ((DELETED++))
    echo "  ✓ Deleted run $id"
  else
    ((FAILED++))
    echo "  ✗ Failed to delete run $id"
  fi
done <<< "$RUN_IDS"

echo ""
echo "✅ Done! Deleted $DELETED run(s)."
if [ $FAILED -gt 0 ]; then
  echo "⚠️  Failed to delete $FAILED run(s)."
  exit 1
fi
