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

# run_handback <name> <agent_type or ""> <report> <expected first line of the verdict file>
# Runs the hook in handback mode as the PreToolUse event of a SubagentHandback call; the hook must
# never block that call, so its output must be empty.
run_handback() {
  local name="$1" agent="$2" report="$3" expected="$4"
  local dir out actual
  dir=$(mktemp -d)
  mkdir -p "$dir/openspec/changes/demo" "$dir/.claude"
  out=$(python3 -c 'import json,sys
d={"hook_event_name":"PreToolUse","tool_name":"SubagentHandback","tool_input":{"message":sys.argv[2]}}
if sys.argv[1]: d["agent_type"]=sys.argv[1]
print(json.dumps(d))' "$agent" "$report" | CLAUDE_PROJECT_DIR="$dir" bash "$HOOK" handback)
  actual=$(head -1 "$dir/openspec/changes/demo/.verdict" 2>/dev/null || echo "<no verdict file>")
  if [ "$actual" = "$expected" ] && [ -z "$out" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected '$expected' and no output, got '$actual' and output '$out'"
    failures=$((failures + 1))
  fi
  rm -rf "$dir"
}

REPORT_TEXT=$(printf 'All good.\n\nCHANGE: demo\nVERDICT: PASS\nGAPS:\n')
PARTIAL_TEXT=$(printf 'Gaps.\n\nCHANGE: demo\nVERDICT: PARTIAL\nGAPS:\n- a gap\n')

run_handback "handback: records the verdict from the hand-back call of a verifier" \
  "change-verifier" "$REPORT_TEXT" "PASS"
run_handback "handback: records a PARTIAL verdict" "change-verifier" "$PARTIAL_TEXT" "PARTIAL"
run_handback "handback: ignores the hand-back of another agent type" \
  "general-purpose" "$REPORT_TEXT" "<no verdict file>"
run_handback "handback: ignores a call without an agent type" "" "$REPORT_TEXT" "<no verdict file>"
run_handback "handback: never blocks, even without a trailer" \
  "change-verifier" "No trailer here." "<no verdict file>"

# A background verifier hands its report back before it stops, so at SubagentStop there is no
# final message and the transcript does not hold the report yet: stop must not block it.
stop_dir=$(mktemp -d)
mkdir -p "$stop_dir/openspec/changes/demo" "$stop_dir/.claude"
make_transcript '[{"type":"text","text":"working"}]' >"$stop_dir/transcript.jsonl"
stop_out=$(python3 -c 'import json,sys; print(json.dumps({"agent_type":"change-verifier","agent_transcript_path":sys.argv[1],"stop_hook_active":False}))' \
  "$stop_dir/transcript.jsonl" | CLAUDE_PROJECT_DIR="$stop_dir" bash "$HOOK" stop)
if [ -z "$stop_out" ]; then
  echo "ok   stop: does not block a background run that already handed back"
else
  echo "FAIL stop: does not block a background run that already handed back: got '$stop_out'"
  failures=$((failures + 1))
fi
rm -rf "$stop_dir"

[ "$failures" -eq 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
