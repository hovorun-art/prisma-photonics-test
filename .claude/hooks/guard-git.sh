#!/bin/bash
# PreToolUse hook (Bash): decides git commands that write history or move branches, however they are
# spelled (git -C <dir> ..., chained commands).
#   - commit / cherry-pick on the main branch (MAIN_BRANCH in flow.conf): denied, the main branch only
#     receives merges.
#   - commit / cherry-pick on any other branch (a change or fix branch, a parallel group's worktree):
#     allowed without asking, for the main agent and subagents alike.
#   - push, merge, rebase, reset, revert, tag, gh pr merge: the user is asked.
# The branch is the one of the repository the command runs in: `git -C <dir>` when given, else the cwd.
# Asking too often is harmless; committing on the main branch unasked is not.
MAIN_BRANCH=master
# shellcheck disable=SC1091
[ -f "${CLAUDE_PROJECT_DIR:-.}/.claude/flow.conf" ] && source "${CLAUDE_PROJECT_DIR:-.}/.claude/flow.conf"
export MAIN_BRANCH

python3 -c '
import json, os, re, subprocess, sys

data = json.load(sys.stdin)
cmd = data.get("tool_input", {}).get("command", "")
cwd = data.get("cwd") or os.getcwd()
main = os.environ.get("MAIN_BRANCH", "master")

def decide(decision, reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)

def branch_of(directory):
    try:
        out = subprocess.run(["git", "-C", directory, "rev-parse", "--abbrev-ref", "HEAD"],
                             capture_output=True, text=True, timeout=5)
    except Exception:
        return None
    return out.stdout.strip() if out.returncode == 0 else None

if re.search(r"\bgh\s+pr\s+merge\b", cmd):
    decide("ask", "Project rule: merging into the main branch needs the user'"'"'s approval.")

asks = []
allowed = False
for m in re.finditer(r"\bgit\b([^|;&]*)\b(commit|cherry-pick|push|merge|rebase|reset|revert|tag)\b", cmd):
    opts, sub = m.group(1), m.group(2)
    if sub in ("commit", "cherry-pick"):
        c = re.search(r"-C\s+([^\s]+)", opts)
        directory = os.path.expanduser(c.group(1)) if c else cwd
        if not os.path.isabs(directory):
            directory = os.path.join(cwd, directory)
        branch = branch_of(directory)
        if branch == main:
            decide("deny", f"Project rule: never commit on the main branch ({main}); the main branch only receives merges. Commit on the change or fix branch.")
        if branch is None:
            asks.append(sub)
        else:
            allowed = True
    else:
        asks.append(sub)

if asks:
    decide("ask", "Project rule: " + ", ".join(sorted(set(asks))) + " changes git history or branches and needs the user'"'"'s approval.")
if allowed:
    decide("allow", "Project rule: commits on a branch other than the main branch need no approval.")
' 2>/dev/null
exit 0
