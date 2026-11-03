#!/usr/bin/env bash
set -euo pipefail

case "${RESULT:-}" in
  new_native|new_generated) ;;
  *) echo 'Only new deterministic feeds can be published.' >&2; exit 1 ;;
esac
if [ "${VERIFIED:-}" != true ]; then
  echo 'Refusing to publish an unverified feed.' >&2
  exit 1
fi
: "${GITHUB_REPOSITORY:?}" "${GITHUB_OUTPUT:?}" "${BRANCH:?}"
: "${CONFIG_NAME:?}" "${SOURCE_URL:?}" "${ISSUE_NUMBER:?}" "${HEAD_SHA:?}"

body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT
printf 'Deterministically generated and verified from `%s`.\n\nCloses #%s\n' \
  "$SOURCE_URL" "$ISSUE_NUMBER" > "$body_file"

args=(pr create --repo "$GITHUB_REPOSITORY" --base main --head "$BRANCH"
  --title "feat(feed): add ${CONFIG_NAME}" --body-file "$body_file")
if [ "$RESULT" = new_generated ]; then
  args+=(--draft)
fi
pr_url=$(gh "${args[@]}")
echo "url=$pr_url" >> "$GITHUB_OUTPUT"

if [ "$RESULT" = new_native ]; then
  # GitHub computes mergeability asynchronously after PR creation.
  for attempt in {1..10}; do
    mergeable=$(gh pr view "$pr_url" --repo "$GITHUB_REPOSITORY" --json mergeable --jq .mergeable)
    if [ "$mergeable" != UNKNOWN ]; then break; fi
    sleep 1
  done
  # Use the normal merge rules; never bypass protection or merge a changed head.
  gh pr merge "$pr_url" --repo "$GITHUB_REPOSITORY" --merge --match-head-commit "$HEAD_SHA"
  state=$(gh pr view "$pr_url" --repo "$GITHUB_REPOSITORY" --json state --jq .state)
  if [ "$state" != MERGED ]; then
    echo "Native feed PR was not merged (state: $state)." >&2
    exit 1
  fi
  echo 'published=true' >> "$GITHUB_OUTPUT"
else
  echo 'published=false' >> "$GITHUB_OUTPUT"
fi
