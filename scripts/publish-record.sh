#!/usr/bin/env bash
#
# Publishes newly collected record rows to the branch, surviving a concurrent
# writer.
#
# The record is append-only, and two writers append to the same monthly file: the
# hourly check and the census, which takes forty minutes and therefore overlaps an
# hourly run every single time it runs. Git sees two additions at the end of one
# file and calls it a content conflict. It is not one — the correct merge of two
# appends is both appends — but git has no way to know that.
#
# So this does not rebase. It captures the lines this run added, takes whatever is
# now on the branch, re-appends, and pushes. That is the append-only merge, stated
# directly rather than negotiated with a three-way merge that cannot see it.
#
# The previous implementation rebased and retried three times. It could not
# succeed: the first conflict left the repository mid-rebase, so the two remaining
# attempts failed with "Pulling is not possible because you have unmerged files".
# A retry loop that cannot retry cost a completed 40-minute sweep of 2,300
# government domains (run 32605088681) — the readings survived only because they
# had already been uploaded as an artifact.
#
# Usage: publish-record.sh <branch> <commit-message>

set -euo pipefail

branch="${1:?branch required}"
message="${2:?commit message required}"

if [ -z "$(git status --porcelain data/)" ]; then
  echo "no new observations — nothing to commit"
  exit 0
fi

git config user.name 'govwebchecker[bot]'
git config user.email 'govwebchecker[bot]@users.noreply.github.com'

# Stage first so a brand-new month's file counts as added rather than untracked.
git add -A data/

staged="$(mktemp -d)"
trap 'rm -rf "$staged"' EXIT

# Capture what this run appended, per file. `--unified=0` keeps the diff to the
# added lines alone, and stripping the leading `+` recovers them verbatim.
files=()
while IFS= read -r file; do
  [ -n "$file" ] || continue
  files+=("$file")
  mkdir -p "$staged/$(dirname "$file")"
  git diff --cached --unified=0 -- "$file" \
    | grep '^+' | grep -v '^+++' | sed 's/^+//' > "$staged/$file"
done < <(git diff --cached --name-only -- data/)

if [ ${#files[@]} -eq 0 ]; then
  echo "nothing staged under data/ — nothing to publish"
  exit 0
fi

echo "publishing $(cat "${files[@]/#/$staged/}" | wc -l) new rows across ${#files[@]} file(s)"

for attempt in 1 2 3 4 5; do
  git fetch origin "$branch"
  # Take the branch as it stands, then re-append. Any rows another writer landed
  # while we were collecting are already in this tree and are never overwritten —
  # which is the whole point, because losing them would be a silent hole.
  git reset --hard "origin/$branch" --quiet

  for file in "${files[@]}"; do
    mkdir -p "$(dirname "$file")"
    cat "$staged/$file" >> "$file"
  done

  git add -A data/
  if [ -z "$(git diff --cached --name-only)" ]; then
    echo "nothing to commit after merging with the branch"
    exit 0
  fi
  git commit -q -m "$message"

  if git push origin "HEAD:$branch"; then
    echo "published on attempt $attempt"
    exit 0
  fi

  echo "push rejected — another writer landed first, retrying (attempt $attempt)" >&2
  sleep $((attempt * 5))
done

echo "could not publish the record after 5 attempts" >&2
exit 1
