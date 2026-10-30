#!/bin/bash
# Tests for run-tests.sh (the Stop-time checks): CHECK_CMDS run only when a file matching
# CHECK_TRIGGER changed since the last green run, so edits to docs or instructions do not start a
# full test run.
# Run: bash .claude/hooks/tests/run-tests.test.sh
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/run-tests.sh"
failures=0

# run_case <name> <trigger regex> <changed file or ""> <expected: ran | skipped> [marker: yes | no]
# Sets up a project whose only check writes a file, marks a green run, then touches the changed file.
run_case() {
  local name="$1" trigger="$2" changed="$3" expected="$4" marker="${5:-yes}"
  local dir actual
  dir=$(mktemp -d)
  mkdir -p "$dir/.claude"
  cat >"$dir/.claude/flow.conf" <<EOF
CHECKS_REQUIRE=
CHECK_CMDS=("touch checks-ran")
CHECK_TRIGGER='$trigger'
ENGLISH_ONLY=0
IGNORED_DIRS="node_modules dist"
EOF
  if [ "$marker" = "yes" ]; then
    touch -t 202001010000 "$dir/.claude/.tests-passed"
  fi
  if [ -n "$changed" ]; then
    mkdir -p "$dir/$(dirname "$changed")"
    touch "$dir/$changed"
  fi
  echo '{}' | CLAUDE_PROJECT_DIR="$dir" bash "$HOOK" >/dev/null
  if [ -f "$dir/checks-ran" ]; then actual=ran; else actual=skipped; fi
  if [ "$actual" = "$expected" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected '$expected', got '$actual'"
    failures=$((failures + 1))
  fi
  rm -rf "$dir"
}

CODE='\.(ts|tsx|json)$'

run_case "runs the checks when a source file changed" "$CODE" "apps/a/src/main.ts" ran
run_case "skips the checks when only a document changed" "$CODE" "CLAUDE.md" skipped
run_case "skips the checks when nothing changed" "$CODE" "" skipped
run_case "ignores changes inside a nested ignored directory" "$CODE" "apps/a/node_modules/x/index.ts" skipped
run_case "runs the checks on any change when CHECK_TRIGGER is empty" "" "README.md" ran
run_case "runs the checks when there was no green run yet" "$CODE" "CLAUDE.md" ran no

[ "$failures" -eq 0 ] || exit 1
