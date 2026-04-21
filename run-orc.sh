#!/usr/bin/env bash

# Safe wrapper script for running the WorkTree Orchestrator
# Automatically loads .env file if it exists

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}🚀 WorkTree Orchestrator Launcher${NC}\n"

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found${NC}"
    echo ""
    echo "To use real AI agents, you need to set up your OpenAI API key:"
    echo ""
    echo "  1. Copy the example file:"
    echo -e "     ${GREEN}cp .env.example .env${NC}"
    echo ""
    echo "  2. Edit .env and add your OpenAI API key:"
    echo -e "     ${GREEN}nano .env${NC}"
    echo ""
    echo "  3. Get your key from: https://platform.openai.com/api-keys"
    echo ""
    echo -e "${BLUE}For now, running in MOCK MODE (no API key needed)...${NC}\n"

    # Run in mock mode
    exec node apps/api/bin/orc.cjs "$@" --mock
else
    # Load .env file
    echo -e "${GREEN}✓ Loading environment from .env${NC}"
    set -a  # Automatically export all variables
    source .env
    set +a

    # Check if API key is set
    if [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${RED}✗ OPENAI_API_KEY not found in .env${NC}"
        echo ""
        echo "Please add your OpenAI API key to .env:"
        echo -e "  ${GREEN}OPENAI_API_KEY=sk-proj-...your-key...${NC}"
        echo ""
        exit 1
    fi

    # Mask the key for display (show first 7 and last 4 chars)
    KEY_PREFIX="${OPENAI_API_KEY:0:10}"
    KEY_SUFFIX="${OPENAI_API_KEY: -4}"
    MASKED_KEY="${KEY_PREFIX}...${KEY_SUFFIX}"
    echo -e "${GREEN}✓ OPENAI_API_KEY loaded: ${MASKED_KEY}${NC}\n"

    # Run the orchestrator with all arguments
    exec node apps/api/bin/orc.cjs "$@"
fi
