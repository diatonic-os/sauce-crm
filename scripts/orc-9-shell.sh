#!/usr/bin/env bash
# orc-9-shell — launch the Sauce CRM swarm cockpit.
#
# Two GNOME terminal windows, each hosting a tmux session:
#
#   Window 1 — "swarm-cockpit" (4 panes):
#     ┌──────────────────────┬──────────────────────┐
#     │ orchestrator         │ coder stream         │
#     │ (batch log + tally)  │ (Coder NIM tokens)   │
#     ├──────────────────────┼──────────────────────┤
#     │ compiler             │ blackboard           │
#     │ (tsc results live)   │ (every event jsonl)  │
#     └──────────────────────┴──────────────────────┘
#
#   Window 2 — "quorum-council" (5 panes, one per NIM voter + validator pool):
#     reviewer | formatter | linter | contract | local-validators
#
# Files written by the swarm (and tailed by the panes):
#   .sauce/memory/nim-stream.log   — coder/voter token deltas with role headers
#   .sauce/memory/blackboard-*.jsonl — every event (votes, tallies, diffs)
# Files written by THIS script (per-role demuxes of nim-stream):
#   /tmp/orc-bus/<session>/{coder,reviewer,formatter,linter,contract,compiler,validator,blackboard}.log
#
# Usage:
#   orc-9-shell.sh [SESSION_NAME]
#     SESSION_NAME defaults to "swarm-<timestamp>".

set -u

SESSION_TAG="${1:-swarm-$(date +%H%M%S)}"
BUS_DIR="/tmp/orc-bus/$SESSION_TAG"
BB_DIR="$HOME/Desktop/sauce-graph/plugin/.sauce/memory"
NIM_STREAM="$BB_DIR/nim-stream.log"

mkdir -p "$BUS_DIR"
touch "$NIM_STREAM" 2>/dev/null

# Plain files (NOT fifos — fifos block writers when no reader is attached,
# losing lines). Each pane just `tail -F`'s its file.
for role in orchestrator coder compiler blackboard reviewer formatter linter contract validator; do
  : > "$BUS_DIR/$role.log"
done

# Background demux: tail nim-stream.log, route each line to the
# role-specific log based on the most recent `▸▸▸ role ▸▸▸` header.
demux() {
  local current="orchestrator"
  tail -F -n0 "$NIM_STREAM" 2>/dev/null | while IFS= read -r line; do
    if [[ "$line" == *"▸▸▸ "* ]]; then
      current=$(printf '%s' "$line" | sed -nE 's/.*▸▸▸ ([a-z]+) .*/\1/p')
      [[ -z "$current" ]] && current="orchestrator"
    elif [[ "$line" == *"◂◂◂ "* ]]; then
      printf '%s\n' "$line" >> "$BUS_DIR/${current}.log"
      current="orchestrator"
      continue
    fi
    printf '%s\n' "$line" >> "$BUS_DIR/${current}.log"
  done
}
demux &
DEMUX_PID=$!
echo $DEMUX_PID > "$BUS_DIR/demux.pid"

# Background blackboard pretty-printer: follows whichever blackboard
# JSONL is newest; emits one human-readable line per event.
bb_demux() {
  local prev="" bb_pid=""
  while true; do
    cur=$(ls -t "$BB_DIR"/blackboard-*.jsonl 2>/dev/null | head -1)
    if [[ -n "$cur" && "$cur" != "$prev" ]]; then
      [[ -n "$bb_pid" ]] && kill "$bb_pid" 2>/dev/null
      printf '▼ now: %s\n' "$(basename "$cur")" >> "$BUS_DIR/blackboard.log"
      ( tail -F -n0 "$cur" 2>/dev/null | jq -r --unbuffered \
          '"[r=" + (.round|tostring) + " " + .agent_id + ":" + .event_type + "] " + ((.payload.vote // .payload.summary // .payload.rationale // (.payload|tostring))[0:160])' \
          >> "$BUS_DIR/blackboard.log" 2>/dev/null
      ) &
      bb_pid=$!
      prev="$cur"
    fi
    sleep 4
  done
}
bb_demux &
BB_PID=$!
echo $BB_PID > "$BUS_DIR/bb-demux.pid"

# Also route validator votes from the blackboard to the validator pane.
# Each "vote" event whose agent_id starts with "validator:" gets surfaced.
val_demux() {
  local prev="" vp=""
  while true; do
    cur=$(ls -t "$BB_DIR"/blackboard-*.jsonl 2>/dev/null | head -1)
    if [[ -n "$cur" && "$cur" != "$prev" ]]; then
      [[ -n "$vp" ]] && kill "$vp" 2>/dev/null
      ( tail -F -n0 "$cur" 2>/dev/null | jq -r --unbuffered \
          'select(.agent_id|startswith("validator:")) | "[r=" + (.round|tostring) + " " + .agent_id + "] " + .payload.verdict + " — " + (.payload.rationale[0:160])' \
          >> "$BUS_DIR/validator.log" 2>/dev/null
      ) &
      vp=$!
      prev="$cur"
    fi
    sleep 4
  done
}
val_demux &
VAL_PID=$!
echo $VAL_PID > "$BUS_DIR/val-demux.pid"

# Compiler events from the blackboard → compiler pane.
comp_demux() {
  local prev="" cp=""
  while true; do
    cur=$(ls -t "$BB_DIR"/blackboard-*.jsonl 2>/dev/null | head -1)
    if [[ -n "$cur" && "$cur" != "$prev" ]]; then
      [[ -n "$cp" ]] && kill "$cp" 2>/dev/null
      ( tail -F -n0 "$cur" 2>/dev/null | jq -r --unbuffered \
          'select(.agent_id=="compiler") | "[r=" + (.round|tostring) + "] " + .payload.vote + " — " + (.payload.rationale[0:160])' \
          >> "$BUS_DIR/compiler.log" 2>/dev/null
      ) &
      cp=$!
      prev="$cur"
    fi
    sleep 4
  done
}
comp_demux &
COMP_PID=$!
echo $COMP_PID > "$BUS_DIR/comp-demux.pid"

# ---- Window 1: swarm-cockpit (4-pane tmux in gnome-terminal) ----
COCKPIT="$SESSION_TAG-cockpit"
tmux kill-session -t "$COCKPIT" 2>/dev/null
tmux new-session -d -s "$COCKPIT" -n cockpit \
  "bash -c 'echo \"═══ CODER STREAM ═══\"; tail -F $BUS_DIR/coder.log 2>/dev/null'"
tmux split-window -h -t "$COCKPIT:0" \
  "bash -c 'echo \"═══ BLACKBOARD ═══\"; tail -F $BUS_DIR/blackboard.log 2>/dev/null'"
tmux split-window -v -t "$COCKPIT:0.0" \
  "bash -c 'echo \"═══ COMPILER (tsc gate) ═══\"; tail -F $BUS_DIR/compiler.log 2>/dev/null'"
tmux split-window -v -t "$COCKPIT:0.1" \
  "bash -c 'echo \"═══ ORCHESTRATOR ═══\"; tail -F $BUS_DIR/orchestrator.log 2>/dev/null'"
tmux select-layout -t "$COCKPIT:0" tiled
gnome-terminal --window --title "Sauce Swarm Cockpit ($SESSION_TAG)" --geometry=200x55 \
  -- bash -c "tmux attach -t $COCKPIT" 2>/dev/null & disown

# ---- Window 2: quorum-council (5-pane tmux in second gnome-terminal) ----
COUNCIL="$SESSION_TAG-council"
tmux kill-session -t "$COUNCIL" 2>/dev/null
tmux new-session -d -s "$COUNCIL" -n council \
  "bash -c 'echo \"═══ REVIEWER ═══\"; tail -F $BUS_DIR/reviewer.log 2>/dev/null'"
tmux split-window -h -t "$COUNCIL:0" \
  "bash -c 'echo \"═══ FORMATTER ═══\"; tail -F $BUS_DIR/formatter.log 2>/dev/null'"
tmux split-window -h -t "$COUNCIL:0" \
  "bash -c 'echo \"═══ LINTER ═══\"; tail -F $BUS_DIR/linter.log 2>/dev/null'"
tmux split-window -v -t "$COUNCIL:0.0" \
  "bash -c 'echo \"═══ CONTRACT ═══\"; tail -F $BUS_DIR/contract.log 2>/dev/null'"
tmux split-window -v -t "$COUNCIL:0.1" \
  "bash -c 'echo \"═══ LOCAL VALIDATORS (Jamba × Phi × 4 roles) ═══\"; tail -F $BUS_DIR/validator.log 2>/dev/null'"
tmux select-layout -t "$COUNCIL:0" tiled
gnome-terminal --window --title "Sauce Quorum Council ($SESSION_TAG)" --geometry=180x50 \
  -- bash -c "tmux attach -t $COUNCIL" 2>/dev/null & disown

# ---- Summary ----
echo "Sauce CRM 9-shell cockpit launched."
echo "  session:        $SESSION_TAG"
echo "  bus dir:        $BUS_DIR"
echo "  cockpit (4):    coder | blackboard | compiler | orchestrator"
echo "  council (5):    reviewer | formatter | linter | contract | validator-pool"
echo ""
echo "Cleanup: pkill -f \"orc-bus/$SESSION_TAG\""
echo "Or: kill \$(cat $BUS_DIR/*.pid)"
