#!/usr/bin/env bash

# Tagged version script - creates semantic run IDs for tracking
# Usage: ./run-orc-tagged.sh <version-tag> "goal" --template <name>
# Example: ./run-orc-tagged.sh v1.0-cyberpunk "Create cyberpunk track" --template strudel-track

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${CYAN}🏷️  WorkTree Orchestrator - Tagged Run${NC}\n"

# Check if version tag provided
if [ $# -lt 1 ]; then
    echo -e "${RED}Error: Version tag required${NC}"
    echo ""
    echo "Usage: $0 <version-tag> <goal> [options]"
    echo ""
    echo "Examples:"
    echo "  $0 v1.0-cyberpunk \"Create cyberpunk track\" --template strudel-track"
    echo "  $0 demo-2024-04-21 \"Demo track for meeting\" --template strudel-track"
    echo "  $0 experiment-bass-heavy \"Test heavy bass\" --template strudel-track"
    echo ""
    echo "The version tag will be part of the run-id: <tag>-<timestamp>"
    exit 1
fi

VERSION_TAG="$1"
shift  # Remove first argument, pass rest to orc

# Validate tag format (alphanumeric, hyphens, underscores only)
if ! [[ "$VERSION_TAG" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo -e "${RED}Error: Invalid tag format${NC}"
    echo "Tag must contain only letters, numbers, hyphens, and underscores"
    echo "Examples: v1.0, demo-2024, experiment_1, cyberpunk-v2"
    exit 1
fi

# Generate tagged run ID
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RUN_ID="${VERSION_TAG}-${TIMESTAMP}"

echo -e "${CYAN}Version Tag:${NC} ${VERSION_TAG}"
echo -e "${CYAN}Run ID:${NC} ${RUN_ID}"
echo -e "${CYAN}Timestamp:${NC} ${TIMESTAMP}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found${NC}"
    echo -e "Running in ${BLUE}MOCK MODE${NC} (no API key needed)\n"
    MOCK_FLAG="--mock"
else
    # Load .env
    set -a
    source .env
    set +a

    if [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${YELLOW}⚠️  OPENAI_API_KEY not found in .env${NC}"
        echo -e "Running in ${BLUE}MOCK MODE${NC}\n"
        MOCK_FLAG="--mock"
    else
        KEY_PREFIX="${OPENAI_API_KEY:0:10}"
        KEY_SUFFIX="${OPENAI_API_KEY: -4}"
        echo -e "${GREEN}✓ API Key loaded: ${KEY_PREFIX}...${KEY_SUFFIX}${NC}\n"
        MOCK_FLAG=""
    fi
fi

# Create run metadata file
mkdir -p .orc/runs
RUN_METADATA_FILE=".orc/runs/${RUN_ID}.meta.json"

cat > "$RUN_METADATA_FILE" <<EOF
{
  "runId": "${RUN_ID}",
  "versionTag": "${VERSION_TAG}",
  "timestamp": "${TIMESTAMP}",
  "startedAt": "$(date -Iseconds)",
  "goal": "$1",
  "command": "$0 $*"
}
EOF

echo -e "${GREEN}✓ Created run metadata: ${RUN_METADATA_FILE}${NC}\n"
echo -e "${BLUE}Starting orchestration...${NC}\n"

# Run the orchestrator with all arguments
exec node apps/api/bin/orc.cjs run "$@" $MOCK_FLAG --run-id "$RUN_ID"
