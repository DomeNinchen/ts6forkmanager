#!/usr/bin/env bash
# Publishes one GitHub release per month, named after the month's section in
# CHANGELOG.md. The tag (vYYYY.MM) points at the last commit on main before the
# month ended (Berlin time), the title names the backend, frontend and sidecar
# versions of that commit, and the notes are the month's CHANGELOG section.
#
# Usage: monthly-release.sh [YYYY-MM | all]
#   no argument  the month before the current one
#   YYYY-MM      that month (it has to be over)
#   all          every finished month in CHANGELOG.md that has no release yet
#
# A month that already has a release, or has no CHANGELOG section, is skipped,
# so running it twice changes nothing. A month that cannot be published does
# not stop the others; the script names it and exits 1 at the end. DRY_RUN=1
# prints what would be published instead of calling gh (no GitHub access
# needed).
#
# GitHub counts a new tag on a commit whose workflow files differ from main's
# as creating workflows, and the built-in GITHUB_TOKEN never gets the
# Workflows permission for that: it answers 403 "Resource not accessible by
# integration". That is the case for every month before this workflow existed
# (September and October 2026); those need the RELEASE_TOKEN secret described
# in .github/workflows/release.yml.
set -euo pipefail

export TZ=Europe/Berlin
export LC_ALL=C

ref="${RELEASE_REF:-origin/main}"
repo="${GITHUB_REPOSITORY:-DomeNinchen/ts6forkmanager}"
changelog="CHANGELOG.md"
current_month=$(date +%Y-%m)

# Every "## <Month> <Year>" heading in the changelog as YYYY-MM, oldest first.
changelog_months() {
  sed -n 's/^## \([A-Z][a-z]* [0-9]\{4\}\)$/\1/p' "$changelog" |
    while read -r heading; do date -d "1 $heading" +%Y-%m; done | sort -u
}

finished_months=$(changelog_months | awk -v cur="$current_month" '$0 < cur')
newest_finished=$(tail -n 1 <<<"$finished_months")

arg="${1:-}"
case "$arg" in
  "") months=$(date -d "$(date +%Y-%m-01) -1 month" +%Y-%m) ;;
  all) months="$finished_months" ;;
  *)
    if ! [[ $arg =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]]; then
      echo "Expected YYYY-MM or 'all', got '$arg'." >&2
      exit 1
    fi
    if [[ ! $arg < $current_month ]]; then
      echo "$arg is not over yet; only finished months get a release." >&2
      exit 1
    fi
    months="$arg"
    ;;
esac

failed=()
for month in $months; do
  tag="v${month/-/.}"
  heading=$(date -d "$month-01" '+%B %Y')

  if [[ -z ${DRY_RUN:-} ]] && gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
    echo "$tag: release exists, skipped."
    continue
  fi

  notes=$(awk -v h="## $heading" '$0 == h { found = 1; next } found && /^## / { exit } found' "$changelog")
  if [[ -z ${notes//[[:space:]]/} ]]; then
    echo "$tag: no '## $heading' section in $changelog, skipped."
    continue
  fi

  next_month_start=$(date -d "$month-01 +1 month" +%Y-%m-01)
  sha=$(git rev-list -1 --first-parent --before="$next_month_start 00:00" "$ref")
  if [[ -z $sha || $(git log -1 --format=%cd --date=format-local:%Y-%m "$sha") != "$month" ]]; then
    echo "$tag: no commit on $ref in $heading, skipped."
    continue
  fi

  backend=$(git show "$sha:packages/backend/package.json" | jq -r .version)
  frontend=$(git show "$sha:packages/frontend/package.json" | jq -r .version)
  sidecar=$(git show "$sha:packages/sidecar/version.go" | sed -n 's/^const Version = "\(.*\)"$/\1/p')
  title="$heading — backend $backend · frontend $frontend · sidecar $sidecar"

  notes_file=$(mktemp)
  {
    printf '%s\n' "$notes"
    printf '\n---\n\nEvery change since the fork started is in [CHANGELOG.md](https://github.com/%s/blob/main/CHANGELOG.md). This tag marks the state of `main` at the end of %s.\n' "$repo" "$heading"
  } >"$notes_file"

  latest=false
  [[ $month == "$newest_finished" ]] && latest=true

  if [[ -n ${DRY_RUN:-} ]]; then
    echo "=== $tag -> ${sha:0:7} ($(git log -1 --format=%cd --date=format-local:'%Y-%m-%d %H:%M' "$sha")), latest=$latest"
    echo "    $title"
    echo "    notes: $(wc -l <"$notes_file") lines, $(wc -c <"$notes_file") bytes"
  elif gh release create "$tag" --repo "$repo" --target "$sha" --title "$title" \
    --notes-file "$notes_file" --latest="$latest"; then
    echo "$tag: published at ${sha:0:7}."
  else
    echo "::warning::$tag: not published, see the gh error above."
    failed+=("$tag")
  fi
  rm -f "$notes_file"
done

if ((${#failed[@]})); then
  echo "Not published: ${failed[*]}. A 403 \"Resource not accessible by integration\" on a month" >&2
  echo "before this workflow existed needs the RELEASE_TOKEN secret (see release.yml)." >&2
  exit 1
fi
