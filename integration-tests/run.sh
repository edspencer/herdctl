#!/bin/bash
# Integration test runner
# Usage: ./run.sh [scenario-name]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================"
echo "herdctl Integration Test Runner"
echo -e "========================================${NC}"

# Load .env file if it exists (check multiple locations)
load_env() {
    local env_file=""

    # Check integration-tests/.env first
    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        env_file="$SCRIPT_DIR/.env"
    # Then check repo root .env
    elif [[ -f "$REPO_ROOT/.env" ]]; then
        env_file="$REPO_ROOT/.env"
    fi

    if [[ -n "$env_file" ]]; then
        echo -e "${BLUE}Loading environment from $env_file${NC}"
        # Export variables from .env file (skip comments and empty lines)
        while IFS= read -r line || [[ -n "$line" ]]; do
            # Skip comments and empty lines
            [[ "$line" =~ ^#.*$ ]] && continue
            [[ -z "$line" ]] && continue
            # Export the variable
            export "$line"
        done < "$env_file"
    fi
}

load_env

# Check prerequisites
if [[ -z "$ANTHROPIC_API_KEY" ]]; then
    echo -e "${RED}ERROR: ANTHROPIC_API_KEY is not set${NC}"
    echo ""
    echo "Options:"
    echo "  1. Create integration-tests/.env with: ANTHROPIC_API_KEY=sk-ant-..."
    echo "  2. Or export it: export ANTHROPIC_API_KEY=your-key-here"
    echo ""
    echo "Get an API key from: https://console.anthropic.com/dashboard"
    exit 1
fi

# Build first
echo -e "${BLUE}Building herdctl...${NC}"
cd "$REPO_ROOT"
pnpm build > /dev/null 2>&1
echo -e "${GREEN}Build complete${NC}"

# Determine which scenarios to run
SCENARIOS_DIR="$SCRIPT_DIR/scenarios"
SCENARIOS_TO_RUN=()

if [[ $# -gt 0 ]]; then
    # Run specific scenario(s)
    for arg in "$@"; do
        scenario_path="$arg"
        # Handle both "scenarios/name" and just "name"
        if [[ ! -d "$scenario_path" ]]; then
            scenario_path="$SCENARIOS_DIR/$arg"
        fi
        if [[ -d "$scenario_path" ]]; then
            SCENARIOS_TO_RUN+=("$scenario_path")
        else
            echo -e "${RED}Scenario not found: $arg${NC}"
            exit 1
        fi
    done
else
    # Run all scenarios
    for scenario_dir in "$SCENARIOS_DIR"/*; do
        if [[ -d "$scenario_dir" && -f "$scenario_dir/test.sh" ]]; then
            SCENARIOS_TO_RUN+=("$scenario_dir")
        fi
    done
fi

if [[ ${#SCENARIOS_TO_RUN[@]} -eq 0 ]]; then
    echo -e "${YELLOW}No scenarios found to run${NC}"
    echo "Create a scenario in $SCENARIOS_DIR/ with a test.sh file"
    exit 0
fi

# Run scenarios
TOTAL_PASSED=0
TOTAL_FAILED=0
FAILED_SCENARIOS=()

for scenario_dir in "${SCENARIOS_TO_RUN[@]}"; do
    scenario_name=$(basename "$scenario_dir")
    echo ""
    echo -e "${BLUE}========================================"
    echo "Running scenario: $scenario_name"
    echo -e "========================================${NC}"

    if [[ ! -f "$scenario_dir/test.sh" ]]; then
        echo -e "${RED}No test.sh found in $scenario_dir${NC}"
        ((TOTAL_FAILED++))
        FAILED_SCENARIOS+=("$scenario_name")
        continue
    fi

    # Make test script executable
    chmod +x "$scenario_dir/test.sh"

    # Run the test
    if "$scenario_dir/test.sh"; then
        echo -e "${GREEN}Scenario PASSED: $scenario_name${NC}"
        ((TOTAL_PASSED++))
    else
        echo -e "${RED}Scenario FAILED: $scenario_name${NC}"
        ((TOTAL_FAILED++))
        FAILED_SCENARIOS+=("$scenario_name")
    fi
done

# Print summary
echo ""
echo -e "${BLUE}========================================"
echo "Integration Test Summary"
echo -e "========================================${NC}"
echo -e "${GREEN}Passed: $TOTAL_PASSED${NC}"
echo -e "${RED}Failed: $TOTAL_FAILED${NC}"

if [[ ${#FAILED_SCENARIOS[@]} -gt 0 ]]; then
    echo ""
    echo -e "${RED}Failed scenarios:${NC}"
    for scenario in "${FAILED_SCENARIOS[@]}"; do
        echo "  - $scenario"
    done
fi

echo "========================================"

if [[ $TOTAL_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
