#!/bin/bash
# Tests for guard-git.sh: a commit is allowed on a change branch, denied on the main branch, and the
# other history-writing commands ask, wherever the command points (cwd or git -C <dir>).
# Run: bash .claude/hooks/tests/guard-git.test.sh
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/guard-git.sh"
failures=0

# A project dir with flow.conf and a repo on branch $1 (one commit so HEAD exists).
make_project() {
  local dir
  dir=$(mktemp -d)
  mkdir -p "$dir/.claude"
  echo "MAIN_BRANCH=master" >"$dir/.claude/flow.conf"
  git -C "$dir" init -q -b "$1"
  git -C "$dir" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  echo "$dir"
}

# run_case <name> <branch> <command> <expected decision: allow|deny|ask|none> [cwd]
run_case() {
  local name="$1" branch="$2" command="$3" expected="$4"
  local dir cwd actual
  dir=$(make_project "$branch")
  cwd="${5:-$dir}"
  cwd="${cwd//__DIR__/$dir}"
  command="${command//__DIR__/$dir}"
  actual=$(python3 -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$command" "$cwd" \
    | CLAUDE_PROJECT_DIR="$dir" bash "$HOOK" \
    | python3 -c 'import json,sys; s=sys.stdin.read(); print(json.loads(s)["hookSpecificOutput"]["permissionDecision"] if s.strip() else "none")')
  if [ "$actual" = "$expected" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected '$expected', got '$actual'"
    failures=$((failures + 1))
  fi
  rm -rf "$dir"
}

run_case "commit on a change branch is allowed" reliability 'git commit -m "feat: x"' allow
run_case "commit on the main branch is denied" master 'git commit -m "feat: x"' deny
run_case "commit with -C to a main-branch repo is denied" master 'git -C __DIR__ commit -m "x"' deny "/"
run_case "commit with -C to a change-branch repo is allowed" fix/thing 'git -C __DIR__ commit -m "x"' allow "/"
run_case "chained add and commit on a change branch is allowed" reliability 'git add -A && git commit -m "x"' allow
run_case "cherry-pick on a change branch is allowed" reliability 'git cherry-pick abc123' allow
run_case "push asks even on a change branch" reliability 'git push origin reliability' ask
run_case "merge asks" reliability 'git merge fix/thing' ask
run_case "reset asks" reliability 'git reset --hard HEAD~1' ask
run_case "commit chained with a push asks" reliability 'git commit -m x && git push' ask
run_case "gh pr merge asks" reliability 'gh pr merge 12' ask
run_case "commit outside a repo asks" reliability 'git commit -m x' ask "/"
run_case "read-only git command is left alone" master 'git status && git log -1' none
run_case "non-git command is left alone" master 'npm test' none

[ "$failures" -eq 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
