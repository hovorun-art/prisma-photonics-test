#!/bin/bash
# PostToolUse hook (Edit|Write): lint the file Claude just changed.
# Exit 2 feeds the linter output back to Claude so it fixes the issue right away.
# Silent no-op until LINT_FILE_CMD in .claude/flow.conf points to an installed linter.
file=$(python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
source .claude/flow.conf 2>/dev/null || exit 0

[ -n "${LINT_FILE_CMD:-}" ] || exit 0
[[ "$file" =~ \.(${LINT_FILE_EXT})$ ]] || exit 0
[ -f "$file" ] || exit 0
linter=${LINT_FILE_CMD%% *}
# A file in a parallel group's worktree is linted from that worktree (its own config and node_modules).
top=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) && [ -x "$top/$linter" ] && cd "$top"
[ -x "$linter" ] || command -v "$linter" >/dev/null 2>&1 || exit 0

# shellcheck disable=SC2086
out=$($LINT_FILE_CMD "$file" 2>&1) && exit 0
echo "The linter found problems in $file, fix them:" >&2
echo "$out" | head -40 >&2
exit 2
