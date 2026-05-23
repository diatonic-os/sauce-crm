#!/usr/bin/env bash
# SDK green-gate (PostToolUse hook).
# After a .ts edit/write in the sdk-build worktree, run the typecheck gate and
# surface any tsc errors back to the model as additionalContext (non-blocking,
# so ralph keeps flow but always sees red immediately). Deterministic: same
# tree ⇒ same result.
set -u
payload=$(cat)
f=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)
case "$f" in
  *.ts) : ;;            # gate only TypeScript edits
  *) exit 0 ;;
esac
errs=$(npm run --silent typecheck 2>&1 | grep -E 'error TS' | head -30)
if [ -n "$errs" ]; then
  jq -cn --arg e "$errs" \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:("SDK green-gate — typecheck FAILED, fix before continuing:\n"+$e)}}'
fi
exit 0
