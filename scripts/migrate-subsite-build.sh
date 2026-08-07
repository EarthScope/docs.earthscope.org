#!/usr/bin/env bash
# Migrates a downstream docs subsite repo to the centralized build process.
#
# What it does, given a path to a repo:
#   1. Rewrites every netlify.toml's [build] command (root, or nested e.g.
#      docs/netlify.toml) from the old inline
#      "npm install -g mystmd && myst build --html && ..." recipe to the
#      new one-liner that curls the centralized build script:
#        curl -sSfL https://raw.githubusercontent.com/EarthScope/docs.earthscope.org/main/scripts/build-docs.sh | bash
#   2. Replaces any reference to the old repo name in raw.githubusercontent
#      URLs (EarthScope/CloudDocs -> EarthScope/docs.earthscope.org), e.g.
#      the `extends:` line in myst.yml pointing at es_config/earthscope.yml.
#   3. If anything changed, creates (or reuses) a `md-docs-update` branch
#      and commits just the files this script touched.
#
# Usage:
#   ./migrate-subsite-build.sh /path/to/repo [--dry-run]

set -euo pipefail

OLD_REPO="EarthScope/CloudDocs"
NEW_REPO="EarthScope/docs.earthscope.org"
NEW_BUILD_CMD="curl -sSfL https://raw.githubusercontent.com/${NEW_REPO}/main/scripts/build-docs.sh | bash"
BRANCH="md-docs-update"

if [ $# -lt 1 ]; then
  echo "Usage: $0 /path/to/repo [--dry-run]" >&2
  exit 1
fi

TARGET="$1"
DRY_RUN=false
[ "${2:-}" = "--dry-run" ] && DRY_RUN=true

if [ ! -d "$TARGET/.git" ]; then
  echo "Error: $TARGET does not look like a git repo (no .git dir)" >&2
  exit 1
fi

CHANGED_FILES=()
NEEDS_REVIEW=()

# --- Step 1: rewrite each netlify.toml's inline mystmd build command ---
# netlify.toml may live at the repo root, or inside a subsite's own docs
# folder (e.g. docs/netlify.toml) for repos that build multiple sites.
#
# We only auto-rewrite when the existing command is (whitespace-normalized)
# made up entirely of steps build-docs.sh already performs: install mystmd,
# optionally print its version, build, move into publish$BASE_URL, and write
# a _redirects file. If a repo's command does anything else (extra install
# steps, a custom postprocessing script, different structuring, etc.), we
# leave it untouched and flag it for manual review instead of guessing that
# it's safe to drop.
NETLIFY_TOMLS=$(find "$TARGET" -name node_modules -prune -o -name .git -prune -o -name netlify.toml -print)

if [ -z "$NETLIFY_TOMLS" ]; then
  echo "netlify.toml: none found under $TARGET, skipping."
else
  while IFS= read -r NETLIFY_TOML; do
    echo "netlify.toml: $NETLIFY_TOML"
    if grep -q "build-docs.sh" "$NETLIFY_TOML"; then
      echo "  already using centralized build script, skipping command rewrite."
    elif grep -qE 'myst(md)?\b' "$NETLIFY_TOML"; then
      RESULT=$(python3 - "$NETLIFY_TOML" "$NEW_BUILD_CMD" "$DRY_RUN" <<'PYEOF'
import re, sys

path, new_cmd, dry_run = sys.argv[1], sys.argv[2], sys.argv[3] == "true"
text = open(path).read()

pattern = re.compile(r'command\s*=\s*("""(?:.|\n)*?"""|"(?:[^"\\]|\\.)*")')
m = pattern.search(text)
if not m:
    print("SKIPPED: no `command = ...` field found, left untouched")
    sys.exit()

raw = m.group(1)
interior = raw[3:-3] if raw.startswith('"""') else raw[1:-1]
# join backslash-newline line continuations, then split into individual steps
joined = re.sub(r'\\\s*\n', ' ', interior)
steps = [re.sub(r'\s+', ' ', s).strip() for s in joined.split('&&')]
steps = [s for s in steps if s]

# Each step must match one of the known build-docs.sh-equivalent shapes.
KNOWN_PATTERNS = [
    r'npm install -g mystmd(@[\w.~^]+)?',
    r'myst --version',
    r'myst build( --html)?',
    r'mkdir -p "publish\$BASE_URL"',
    r'mv _build/html/\* "publish\$BASE_URL/"',
]

def is_redirects_step(s):
    # e.g. printf '/*  %s/:splat  301\n' "$BASE_URL" > publish/_redirects
    # loosely matched: exact redirect syntax is build-docs.sh's concern, not ours.
    return (
        s.startswith("printf '")
        and s.endswith('> publish/_redirects')
        and '$BASE_URL' in s
    )

def is_known(s):
    return is_redirects_step(s) or any(re.fullmatch(p, s) for p in KNOWN_PATTERNS)

unknown = [s for s in steps if not is_known(s)]

if unknown:
    print("NEEDS_REVIEW: " + " ;; ".join(steps))
    sys.exit()

def replacement(_match):
    return f'command = "{new_cmd}"'

if dry_run:
    print(f'DRY_RUN: would rewrite command field to: command = "{new_cmd}"')
else:
    new_text = pattern.sub(replacement, text, count=1)
    open(path, "w").write(new_text)
    print("CHANGED")
PYEOF
)
      STATUS="${RESULT%%:*}"
      case "$STATUS" in
        CHANGED)
          echo "  rewrote inline mystmd build command -> centralized build script"
          CHANGED_FILES+=("$NETLIFY_TOML")
          ;;
        DRY_RUN)
          echo "  ${RESULT#*: }"
          ;;
        NEEDS_REVIEW)
          echo "  command doesn't match the known recipe exactly — leaving untouched."
          echo "  steps found: ${RESULT#*: }"
          NEEDS_REVIEW+=("$NETLIFY_TOML")
          ;;
        *)
          echo "  $RESULT"
          ;;
      esac
    else
      echo "  no recognizable inline myst build command found, leaving as-is."
    fi
  done <<< "$NETLIFY_TOMLS"
fi

# --- Step 2: replace old raw.githubusercontent repo references repo-wide ---
echo "Scanning for raw.githubusercontent references to ${OLD_REPO} ..."

MATCHES=$(grep -rl --exclude-dir=.git "raw\.githubusercontent\.com/${OLD_REPO}" "$TARGET" 2>/dev/null || true)

if [ -z "$MATCHES" ]; then
  echo "  none found."
else
  while IFS= read -r file; do
    echo "  $file"
    if $DRY_RUN; then
      grep -n "raw\.githubusercontent\.com/${OLD_REPO}" "$file" | sed 's/^/    [dry-run] would replace: /'
    else
      sed -i.bak -E "s#raw\.githubusercontent\.com/${OLD_REPO}#raw.githubusercontent.com/${NEW_REPO}#g" "$file"
      rm -f "${file}.bak"
      # avoid duplicate entries if step 1 already touched this same file (e.g. netlify.toml)
      already_tracked=false
      for f in "${CHANGED_FILES[@]:-}"; do
        [ "$f" = "$file" ] && already_tracked=true && break
      done
      $already_tracked || CHANGED_FILES+=("$file")
    fi
  done <<< "$MATCHES"
fi

if [ "${#NEEDS_REVIEW[@]}" -gt 0 ]; then
  echo ""
  echo "WARNING: ${#NEEDS_REVIEW[@]} netlify.toml file(s) use a build command that doesn't"
  echo "match the known recipe and were left untouched — review and migrate by hand:"
  printf '  %s\n' "${NEEDS_REVIEW[@]}"
  echo ""
fi

# --- Step 3: branch + commit, only if something actually changed ---
if $DRY_RUN; then
  echo "Dry run complete — no files were modified, no branch/commit created."
  exit 0
fi

if [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
  echo "No changes were necessary — repo already uses the centralized build process. Skipping branch/commit."
  exit 0
fi

echo "Changed files:"
printf '  %s\n' "${CHANGED_FILES[@]}"

if git -C "$TARGET" rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "Branch '$BRANCH' already exists, switching to it."
  git -C "$TARGET" switch "$BRANCH"
else
  git -C "$TARGET" switch -c "$BRANCH"
fi

git -C "$TARGET" add -- "${CHANGED_FILES[@]}"
git -C "$TARGET" commit -m "$(cat <<'EOF'
Point docs build at centralized build-docs.sh script

Replace the inline mystmd install/build steps in netlify.toml with a
call to the shared build-docs.sh script, and repoint raw.githubusercontent
URLs (myst.yml `extends`, netlify.toml) from the renamed CloudDocs repo to
docs.earthscope.org, so this repo picks up future build-process changes
from one place instead of duplicating them.
EOF
)"

echo "Committed on branch '$BRANCH'. Review with: git -C \"$TARGET\" show"
