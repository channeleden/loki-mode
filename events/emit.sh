#!/bin/bash
# Loki Mode Event Emitter - Bash helper for emitting events
#
# Usage:
#   ./emit.sh <type> <source> <action> [key=value ...]
#
# Examples:
#   ./emit.sh session cli start provider=claude
#   ./emit.sh task runner complete task_id=task-001
#   ./emit.sh error hook failed error="Command blocked"
#
# Environment:
#   LOKI_DIR - Path to .loki directory (default: .loki)

set -uo pipefail

# Configuration
LOKI_DIR="${LOKI_DIR:-.loki}"
EVENTS_DIR="$LOKI_DIR/events/pending"

# Ensure directory exists
mkdir -p "$EVENTS_DIR"

# Arguments
TYPE="${1:-state}"
SOURCE="${2:-cli}"
ACTION="${3:-unknown}"
if [ "$#" -ge 3 ]; then shift 3; else shift "$#"; fi

# Generate event ID and timestamp
EVENT_ID=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# JSON escape helper: handles \, ", and control characters
json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g' | tr -d '\n'
}

# Build payload JSON
ACTION_ESC=$(json_escape "$ACTION")
PAYLOAD="{\"action\":\"$ACTION_ESC\""
for arg in "$@"; do
    key="${arg%%=*}"
    value="${arg#*=}"
    key_escaped=$(json_escape "$key")
    value_escaped=$(json_escape "$value")
    PAYLOAD="$PAYLOAD,\"$key_escaped\":\"$value_escaped\""
done
PAYLOAD="$PAYLOAD}"

# Build full event JSON (escape type/source for safe embedding)
TYPE_ESC=$(json_escape "$TYPE")
SOURCE_ESC=$(json_escape "$SOURCE")
EVENT=$(cat <<EOF
{
  "id": "$EVENT_ID",
  "type": "$TYPE_ESC",
  "source": "$SOURCE_ESC",
  "timestamp": "$TIMESTAMP",
  "payload": $PAYLOAD,
  "version": "1.0"
}
EOF
)

# Write event file
EVENT_FILE="$EVENTS_DIR/${TIMESTAMP//:/-}_$EVENT_ID.json"
echo "$EVENT" > "$EVENT_FILE"

# Output event ID
echo "$EVENT_ID"
