#!/bin/bash
# Integration test harness library
# Source this file in your test scripts

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HARNESS_DIR/.." && pwd)"
HERDCTL="$REPO_ROOT/packages/cli/bin/herdctl.js"

# Load .env file if not already loaded by run.sh
load_env_if_needed() {
    if [[ -z "$ANTHROPIC_API_KEY" ]]; then
        local env_file=""
        if [[ -f "$HARNESS_DIR/.env" ]]; then
            env_file="$HARNESS_DIR/.env"
        elif [[ -f "$REPO_ROOT/.env" ]]; then
            env_file="$REPO_ROOT/.env"
        fi

        if [[ -n "$env_file" ]]; then
            while IFS= read -r line || [[ -n "$line" ]]; do
                [[ "$line" =~ ^#.*$ ]] && continue
                [[ -z "$line" ]] && continue
                export "$line"
            done < "$env_file"
        fi
    fi
}

load_env_if_needed

# Test state
TEST_DIR=""
SCENARIO_NAME=""
LAST_JOB_ID=""

# =============================================================================
# Logging
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

log_debug() {
    if [[ -n "$DEBUG" ]]; then
        echo -e "${YELLOW}[DEBUG]${NC} $1"
    fi
}

# =============================================================================
# Prerequisites
# =============================================================================

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check API key
    if [[ -z "$ANTHROPIC_API_KEY" ]]; then
        log_error "ANTHROPIC_API_KEY environment variable is not set"
        exit 1
    fi
    log_debug "API key present"

    # Check herdctl binary exists
    if [[ ! -f "$HERDCTL" ]]; then
        log_error "herdctl binary not found at $HERDCTL"
        log_error "Run 'pnpm build' first"
        exit 1
    fi
    log_debug "herdctl binary found"

    # Check node is available
    if ! command -v node &> /dev/null; then
        log_error "node is not installed"
        exit 1
    fi
    log_debug "node available"

    log_success "Prerequisites check passed"
}

# =============================================================================
# Scenario Management
# =============================================================================

init_scenario() {
    local scenario_name="$1"
    local scenario_src="$HARNESS_DIR/scenarios/$scenario_name"

    SCENARIO_NAME="$scenario_name"

    log_info "Initializing scenario: $scenario_name"

    # Check scenario exists
    if [[ ! -d "$scenario_src" ]]; then
        log_error "Scenario not found: $scenario_src"
        exit 1
    fi

    # Create temp directory for test
    TEST_DIR=$(mktemp -d -t "herdctl-test-$scenario_name-XXXXXX")
    log_debug "Test directory: $TEST_DIR"

    # Copy scenario files
    cp -r "$scenario_src"/* "$TEST_DIR/"

    # Initialize herdctl in test directory
    cd "$TEST_DIR"

    log_success "Scenario initialized in $TEST_DIR"
}

cleanup_scenario() {
    if [[ -n "$TEST_DIR" && -d "$TEST_DIR" ]]; then
        log_info "Cleaning up $TEST_DIR"
        rm -rf "$TEST_DIR"
    fi
}

# Trap to ensure cleanup on exit
trap cleanup_scenario EXIT

# =============================================================================
# herdctl Commands
# =============================================================================

run_herdctl() {
    log_debug "Running: herdctl $*"
    node "$HERDCTL" "$@"
}

trigger_agent() {
    local agent_name="$1"
    shift
    local extra_args=("$@")

    log_info "Triggering agent: $agent_name"

    local output
    output=$(run_herdctl trigger "$agent_name" --json "${extra_args[@]}" 2>&1)
    local exit_code=$?

    log_debug "Trigger output: $output"

    if [[ $exit_code -ne 0 ]]; then
        log_error "Failed to trigger agent: $output"
        return 1
    fi

    # Extract job ID from JSON output
    LAST_JOB_ID=$(echo "$output" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [[ -z "$LAST_JOB_ID" ]]; then
        log_error "Could not extract job ID from output"
        return 1
    fi

    log_success "Triggered job: $LAST_JOB_ID"
    return 0
}

trigger_and_wait() {
    local agent_name="$1"
    local timeout="${2:-120}"  # Default 2 minute timeout
    shift 2 2>/dev/null || shift 1 2>/dev/null || true
    local extra_args=("$@")

    log_info "Triggering agent and waiting: $agent_name (timeout: ${timeout}s)"

    local output
    output=$(timeout "$timeout" node "$HERDCTL" trigger "$agent_name" "${extra_args[@]}" 2>&1)
    local exit_code=$?

    log_debug "Full output: $output"

    if [[ $exit_code -eq 124 ]]; then
        log_error "Trigger timed out after ${timeout}s"
        return 1
    fi

    if [[ $exit_code -ne 0 ]]; then
        log_error "Trigger failed with exit code $exit_code"
        log_error "Output: $output"
        return 1
    fi

    # Extract job ID from output
    LAST_JOB_ID=$(echo "$output" | grep -o 'Job ID:.*' | head -1 | awk '{print $3}')

    if [[ -z "$LAST_JOB_ID" ]]; then
        log_warn "Could not extract job ID from output"
    else
        log_success "Job completed: $LAST_JOB_ID"
    fi

    return 0
}

get_job_status() {
    local job_id="${1:-$LAST_JOB_ID}"

    if [[ -z "$job_id" ]]; then
        log_error "No job ID provided"
        return 1
    fi

    run_herdctl job "$job_id" --json 2>&1
}

get_job_logs() {
    local job_id="${1:-$LAST_JOB_ID}"

    if [[ -z "$job_id" ]]; then
        log_error "No job ID provided"
        return 1
    fi

    run_herdctl job "$job_id" --logs 2>&1
}

# =============================================================================
# Assertions
# =============================================================================

assert_job_completed() {
    local job_id="${1:-$LAST_JOB_ID}"

    log_info "Asserting job completed: $job_id"

    local status
    status=$(get_job_status "$job_id" 2>&1)

    if echo "$status" | grep -q '"status":"completed"'; then
        log_success "Job $job_id is completed"
        return 0
    elif echo "$status" | grep -q 'Status: completed'; then
        log_success "Job $job_id is completed"
        return 0
    else
        log_error "Job $job_id is not completed"
        log_error "Status: $status"
        return 1
    fi
}

assert_job_failed() {
    local job_id="${1:-$LAST_JOB_ID}"

    log_info "Asserting job failed: $job_id"

    local status
    status=$(get_job_status "$job_id" 2>&1)

    if echo "$status" | grep -q '"status":"failed"'; then
        log_success "Job $job_id failed as expected"
        return 0
    elif echo "$status" | grep -q 'Status: failed'; then
        log_success "Job $job_id failed as expected"
        return 0
    else
        log_error "Job $job_id did not fail as expected"
        log_error "Status: $status"
        return 1
    fi
}

assert_output_contains() {
    local expected="$1"
    local job_id="${2:-$LAST_JOB_ID}"

    log_info "Asserting output contains: '$expected'"

    local logs
    logs=$(get_job_logs "$job_id" 2>&1)

    if echo "$logs" | grep -q "$expected"; then
        log_success "Output contains expected text"
        return 0
    else
        log_error "Output does not contain: '$expected'"
        log_error "Actual output:"
        echo "$logs" | head -20
        return 1
    fi
}

assert_output_not_contains() {
    local unexpected="$1"
    local job_id="${2:-$LAST_JOB_ID}"

    log_info "Asserting output does not contain: '$unexpected'"

    local logs
    logs=$(get_job_logs "$job_id" 2>&1)

    if echo "$logs" | grep -q "$unexpected"; then
        log_error "Output unexpectedly contains: '$unexpected'"
        return 1
    else
        log_success "Output does not contain unexpected text"
        return 0
    fi
}

# =============================================================================
# Test Result Tracking
# =============================================================================

TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    local test_fn="$2"

    log_info "Running test: $test_name"

    if $test_fn; then
        ((TESTS_PASSED++))
        log_success "Test passed: $test_name"
    else
        ((TESTS_FAILED++))
        log_error "Test failed: $test_name"
    fi
}

print_results() {
    echo ""
    echo "========================================"
    echo "Test Results for: $SCENARIO_NAME"
    echo "========================================"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
    echo "========================================"

    if [[ $TESTS_FAILED -gt 0 ]]; then
        return 1
    fi
    return 0
}
