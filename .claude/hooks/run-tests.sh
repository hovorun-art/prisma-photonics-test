#!/bin/bash
# Stop-time check: run the language check and CHECK_CMDS from .claude/flow.conf if code changed since
# the last green run. Prints a block decision with the failure output so Claude keeps working.
# Silent no-op while CHECK_CMDS is empty or CHECKS_REQUIRE does not exist.
MAX_ROUNDS=3
cat >/dev/null
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
source .claude/flow.conf 2>/dev/null || exit 0
[ "${#CHECK_CMDS[@]}" -gt 0 ] || exit 0
[ -z "${CHECKS_REQUIRE:-}" ] || [ -e "$CHECKS_REQUIRE" ] || exit 0

ok=.claude/.tests-passed
attempts=.claude/.test-attempts
if [ -f "$ok" ]; then
  prune="-path ./.claude -o -path ./.git -o -path ./openspec"
  for d in $IGNORED_DIRS; do prune="$prune -o -path ./$d"; done
  # shellcheck disable=SC2086
  changed=$(find . \( $prune \) -prune -o -type f -newer "$ok" -print -quit)
  [ -z "$changed" ] && exit 0                       # nothing changed since last green run
fi

check() {
  out=$("$(dirname "$0")/check-language.sh" 2>&1) || return 1
  for cmd in "${CHECK_CMDS[@]}"; do
    out=$(bash -c "$cmd" 2>&1) || { out="\$ $cmd"$'\n'"$out"; return 1; }
  done
}

if check; then
  touch "$ok"; rm -f "$attempts"; exit 0
fi

n=$(cat "$attempts" 2>/dev/null || echo 0)
if [ "$n" -ge "$MAX_ROUNDS" ]; then
  rm -f "$attempts"
  printf '{"systemMessage":"Checks still failing after %s rounds; stopping so you can review."}\n' "$MAX_ROUNDS"
  exit 0
fi
echo $((n + 1)) > "$attempts"
tail=$(echo "$out" | tail -40)
python3 -c 'import json,sys; print(json.dumps({"decision":"block","reason":"Typecheck, lint or tests are failing (round %s of %s). Fix the code (not the tests, unless a test is wrong per the spec), then finish.\n\n%s" % (sys.argv[1], sys.argv[2], sys.argv[3])}))' "$((n + 1))" "$MAX_ROUNDS" "$tail"
exit 0
