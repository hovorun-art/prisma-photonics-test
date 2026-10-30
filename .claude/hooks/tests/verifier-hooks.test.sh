#!/bin/bash
# Tests for verifier-hooks.sh (stop mode): the verdict of the change-verifier is recorded from its
# final report, whether that report is a plain text message or a SubagentHandback tool call.
# Run: bash .claude/hooks/tests/verifier-hooks.test.sh
set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/verifier-hooks.sh"
failures=0

# Writes a one-entry transcript whose last assistant message is $1 (a JSON content array).
make_transcript() {
  python3 -c 'import json,sys; print(json.dumps({"type":"assistant","message":{"role":"assistant","content":json.loads(sys.argv[1])}}))' "$1"
}

# run_case <name> <content-json> <expected first line of the verdict file> [last_assistant_message]
run_case() {
  local name="$1" content="$2" expected="$3" last="${4:-}"
  local dir
  dir=$(mktemp -d)
  mkdir -p "$dir/openspec/changes/demo" "$dir/.claude"
  make_transcript "$content" >"$dir/transcript.jsonl"
  python3 -c 'import json,sys; print(json.dumps({"agent_type":"change-verifier","agent_transcript_path":sys.argv[1],"stop_hook_active":True,"last_assistant_message":sys.argv[2]}))' \
    "$dir/transcript.jsonl" "$last" | CLAUDE_PROJECT_DIR="$dir" bash "$HOOK" stop >/dev/null
  local actual
  actual=$(head -1 "$dir/openspec/changes/demo/.verdict" 2>/dev/null || echo "<no verdict file>")
  if [ "$actual" = "$expected" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected '$expected', got '$actual'"
    failures=$((failures + 1))
  fi
  rm -rf "$dir"
}

REPORT='All good.\n\nCHANGE: demo\nVERDICT: PASS\nGAPS:\n'

run_case "records the verdict from a final text message" \
  "[{\"type\":\"text\",\"text\":\"$REPORT\"}]" "PASS"

run_case "records the verdict from a final SubagentHandback tool call" \
  "[{\"type\":\"tool_use\",\"name\":\"SubagentHandback\",\"input\":{\"message\":\"$REPORT\"}}]" "PASS"

run_case "finds the hand-back report when the last message has no trailer" \
  "[{\"type\":\"tool_use\",\"name\":\"SubagentHandback\",\"input\":{\"message\":\"$REPORT\"}}]" "PASS" \
  "Report handed back."

[ "$failures" -eq 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
