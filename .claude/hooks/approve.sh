#!/bin/bash
# Records the user's approval of a change's decisions by creating openspec/changes/<name>/.decisions-approved.
# Only this hook creates the marker (gate-files.sh denies it to agents), so approval always comes from the user:
#   --prompt : UserPromptSubmit, the user typed /specs-go <name>
#   --answer : PostToolUse on AskUserQuestion, the user picked an option whose label starts with
#              "Approve decisions" in a question that names the change
# The marker is created only when decisions.md has no unchecked item ("- [ ]") left in Assumed or Open
# questions; otherwise the agent is told what is still unresolved. It records the sha256 of decisions.md,
# so gate-files.sh treats a later edit of decisions.md as unapproved.
mode="$1"
input=$(cat)
MODE="$mode" INPUT="$input" python3 - <<'PY'
import datetime, hashlib, json, os, re, sys

mode = os.environ['MODE']
d = json.loads(os.environ.get('INPUT') or '{}')
root = os.environ.get('CLAUDE_PROJECT_DIR') or d.get('cwd') or os.getcwd()
changes = os.path.join(root, 'openspec', 'changes')
event = 'UserPromptSubmit' if mode == '--prompt' else 'PostToolUse'


def say(text):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}))


def approve(name, source):
    folder = os.path.join(changes, name)
    decisions = os.path.join(folder, 'decisions.md')
    if not os.path.isfile(decisions):
        return f"spec-flow: change '{name}' has no decisions.md, so nothing was approved."
    open_items = [l.strip() for l in open(decisions, encoding='utf-8') if re.match(r'\s*- \[ \]', l)]
    if open_items:
        listing = '\n'.join(open_items[:20])
        return (f"spec-flow: the decisions for '{name}' were NOT approved: {len(open_items)} item(s) in "
                f"decisions.md are still unchecked (Assumed or Open questions):\n{listing}\n"
                "Resolve them with the user (AskUserQuestion), record the answers, then offer approval again.")
    stamp = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
    digest = hashlib.sha256(open(decisions, 'rb').read()).hexdigest()
    with open(os.path.join(folder, '.decisions-approved'), 'w', encoding='utf-8') as f:
        f.write(f"approved: {stamp}\nsource: {source}\nsha256: {digest}\n")
    return (f"spec-flow: the user approved the decisions for '{name}'. Specs, design and tasks may now be "
            "written (continue with the specs-go workflow).")


def active():
    if not os.path.isdir(changes):
        return []
    return [n for n in os.listdir(changes) if n != 'archive' and os.path.isdir(os.path.join(changes, n))]


if mode == '--prompt':
    m = re.match(r'\s*/specs-go\s+([A-Za-z0-9._-]+)', d.get('prompt', ''))
    if m and m.group(1) in active():
        say(approve(m.group(1), 'user ran /specs-go'))
    sys.exit(0)

# --answer: find the questions the user answered with "Approve decisions..."
ti = d.get('tool_input') or {}
resp = d.get('tool_response')
questions = [q.get('question', '') for q in ti.get('questions', []) if isinstance(q, dict)]
answers = {}
for src in (ti.get('answers'), resp if isinstance(resp, dict) else None,
            resp.get('answers') if isinstance(resp, dict) else None):
    if isinstance(src, dict):
        answers.update({k: v for k, v in src.items() if isinstance(v, str)})
picked = [q for q, a in answers.items() if a.strip().lower().startswith('approve decisions')]
if not picked:
    text = resp if isinstance(resp, str) else json.dumps(resp or '', ensure_ascii=False)
    picked = [q for q in questions if re.search(re.escape(f'"{q}"="') + r'Approve decisions', text, re.I)]

notes = []
names = sorted(active(), key=len, reverse=True)
for q in picked:
    hit = next((n for n in names if re.search(r'(?<![\w-])' + re.escape(n) + r'(?![\w-])', q)), None)
    if hit:
        notes.append(approve(hit, 'user picked "Approve decisions"'))
    else:
        notes.append('spec-flow: "Approve decisions" was picked, but the question did not name an active '
                     'change, so nothing was approved. Ask again with the change name in the question.')
if notes:
    say('\n'.join(notes))
PY
exit 0
