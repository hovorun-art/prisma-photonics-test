#!/bin/bash
# PreToolUse hook (Bash): makes Claude Code ask the user before any git command that writes history
# or moves branches (commit, push, merge, rebase, reset, cherry-pick, revert, tag, gh pr merge), however
# it is spelled (git -C <dir> ..., chained commands). Asking too often is harmless; committing unasked is not.
python3 -c '
import json, re, sys
cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
if re.search(r"\bgit\b[^|;&]*\b(commit|push|merge|rebase|reset|cherry-pick|revert|tag)\b", cmd) \
        or re.search(r"\bgh\s+pr\s+merge\b", cmd):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": "Project rule: git history changes need the user'"'"'s approval.",
    }}))
' 2>/dev/null
exit 0
