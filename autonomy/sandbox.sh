#!/bin/bash
#===============================================================================
# Loki Mode - Docker Sandbox Manager
# Provides isolated container execution for enhanced security
#
# Usage:
#   ./autonomy/sandbox.sh start [OPTIONS] [PRD_PATH]
#   ./autonomy/sandbox.sh stop
#   ./autonomy/sandbox.sh status
#   ./autonomy/sandbox.sh shell
#
# Environment Variables:
#   LOKI_SANDBOX_IMAGE    - Docker image to use (default: loki-mode:sandbox)
#   LOKI_SANDBOX_NETWORK  - Network mode: bridge, none, host (default: bridge)
#   LOKI_SANDBOX_CPUS     - CPU limit (default: 2)
#   LOKI_SANDBOX_MEMORY   - Memory limit (default: 4g)
#   LOKI_SANDBOX_READONLY - Mount project as read-only (default: false)
#
# Security Features:
#   - Seccomp profile restricts dangerous syscalls
#   - No new privileges flag prevents privilege escalation
#   - Dropped capabilities reduce attack surface
#   - Resource limits prevent DoS
#   - Optional read-only filesystem
#   - API keys mounted read-only
#===============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="${LOKI_PROJECT_DIR:-$(pwd)}"
# Normalize PROJECT_DIR (remove trailing slash)
PROJECT_DIR="${PROJECT_DIR%/}"

# Container name includes path hash to avoid collisions between similarly-named projects
# macOS uses md5 instead of md5sum
PROJECT_HASH=$(echo "$PROJECT_DIR" | md5sum 2>/dev/null | cut -c1-8 || md5 2>/dev/null | cut -c1-8 || echo "$$")
CONTAINER_NAME="loki-sandbox-$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')-${PROJECT_HASH}"

# Sandbox settings
SANDBOX_IMAGE="${LOKI_SANDBOX_IMAGE:-loki-mode:sandbox}"
SANDBOX_NETWORK="${LOKI_SANDBOX_NETWORK:-bridge}"
SANDBOX_CPUS="${LOKI_SANDBOX_CPUS:-2}"
SANDBOX_MEMORY="${LOKI_SANDBOX_MEMORY:-4g}"
SANDBOX_READONLY="${LOKI_SANDBOX_READONLY:-false}"

# API ports
API_PORT="${LOKI_API_PORT:-9898}"
DASHBOARD_PORT="${LOKI_DASHBOARD_PORT:-57374}"

# Security: Prompt injection disabled by default for enterprise security
PROMPT_INJECTION_ENABLED="${LOKI_PROMPT_INJECTION:-false}"

#===============================================================================
# Utility Functions
#===============================================================================

log_info() {
    echo -e "${BLUE}[SANDBOX]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SANDBOX]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[SANDBOX]${NC} $1"
}

log_error() {
    echo -e "${RED}[SANDBOX]${NC} $1" >&2
}

# Check if a port is available
check_port_available() {
    local port="$1"
    if command -v lsof &>/dev/null; then
        ! lsof -i ":$port" &>/dev/null
    elif command -v nc &>/dev/null; then
        ! nc -z localhost "$port" 2>/dev/null
    else
        # Assume available if we can't check
        return 0
    fi
}

# Validate project directory
validate_project_dir() {
    if [[ ! -d "$PROJECT_DIR" ]]; then
        log_error "Project directory does not exist: $PROJECT_DIR"
        return 1
    fi
    if [[ ! -r "$PROJECT_DIR" ]]; then
        log_error "Project directory is not readable: $PROJECT_DIR"
        return 1
    fi
    if [[ "$SANDBOX_READONLY" != "true" ]] && [[ ! -w "$PROJECT_DIR" ]]; then
        log_warn "Project directory is not writable: $PROJECT_DIR"
        log_info "Consider using LOKI_SANDBOX_READONLY=true"
    fi
    return 0
}

# Warn about API keys based on provider
warn_missing_api_keys() {
    local provider="$1"
    case "$provider" in
        claude)
            if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
                log_warn "ANTHROPIC_API_KEY not set - Claude commands will fail inside container"
            fi
            ;;
        codex)
            if [[ -z "${OPENAI_API_KEY:-}" ]]; then
                log_warn "OPENAI_API_KEY not set - Codex commands will fail inside container"
            fi
            ;;
        gemini)
            if [[ -z "${GOOGLE_API_KEY:-}" ]]; then
                log_warn "GOOGLE_API_KEY not set - Gemini commands will fail inside container"
            fi
            ;;
    esac
}

# Cleanup handler for signals
cleanup_container() {
    log_warn "Interrupted - cleaning up container..."
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    exit 130
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Install Docker to use sandbox mode."
        log_error "  macOS: brew install --cask docker"
        log_error "  Linux: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon not running. Start Docker Desktop or dockerd."
        exit 1
    fi
}

build_sandbox_image() {
    local dockerfile="$SKILL_DIR/Dockerfile.sandbox"

    if [[ ! -f "$dockerfile" ]]; then
        log_error "Sandbox Dockerfile not found at $dockerfile"
        exit 1
    fi

    log_info "Building sandbox image..."
    docker build -t "$SANDBOX_IMAGE" -f "$dockerfile" "$SKILL_DIR"
    log_success "Sandbox image built: $SANDBOX_IMAGE"
}

ensure_image() {
    if ! docker image inspect "$SANDBOX_IMAGE" &> /dev/null; then
        log_warn "Sandbox image not found. Building..."
        build_sandbox_image
    fi
}

#===============================================================================
# Git Worktree Sandbox (Fallback for non-Docker environments)
#===============================================================================

# Worktree sandbox settings
WORKTREE_PREFIX="loki-sandbox"
WORKTREE_BASE="${LOKI_WORKTREE_BASE:-${TMPDIR:-/tmp}}"
WORKTREE_STATE_FILE="${PROJECT_DIR}/.loki/sandbox/worktree-state.json"

# Check if Docker is available (non-fatal version)
is_docker_available() {
    command -v docker &>/dev/null && docker info &>/dev/null 2>&1
}

# Check if git worktree is available
is_git_available() {
    command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1
}

# Detect which sandbox mode to use
detect_sandbox_mode() {
    local requested="${1:-auto}"

    case "$requested" in
        docker)
            if is_docker_available; then
                echo "docker"
            else
                log_error "Docker requested but not available"
                return 1
            fi
            ;;
        worktree)
            if is_git_available; then
                echo "worktree"
            else
                log_error "Git not available for worktree sandbox"
                return 1
            fi
            ;;
        auto|*)
            if is_docker_available; then
                echo "docker"
            elif is_git_available; then
                log_warn "Docker not available - using worktree sandbox (soft isolation)"
                echo "worktree"
            else
                log_error "Neither Docker nor Git available for sandbox mode"
                return 1
            fi
            ;;
    esac
}

# Create a worktree sandbox
create_worktree_sandbox() {
    local prd_path="${1:-}"
    local provider="${LOKI_PROVIDER:-claude}"

    local timestamp=$(date +%Y%m%d-%H%M%S)
    local sandbox_name="${WORKTREE_PREFIX}-${timestamp}"
    local sandbox_branch="${WORKTREE_PREFIX}-${timestamp}"
    local sandbox_path="${WORKTREE_BASE}/${sandbox_name}"

    log_warn ""
    log_warn "=========================================="
    log_warn "  WORKTREE SANDBOX - SOFT ISOLATION ONLY"
    log_warn "=========================================="
    log_warn ""
    log_warn "This provides workspace isolation but NOT:"
    log_warn "  - Filesystem isolation (can access any file)"
    log_warn "  - Network isolation (full network access)"
    log_warn "  - Process isolation (no resource limits)"
    log_warn ""
    log_warn "For full isolation, install Docker."
    log_warn ""

    log_info "Creating worktree sandbox..."
    log_info "  Location: $sandbox_path"
    log_info "  Branch:   $sandbox_branch"

    # Check for existing sandbox
    if [[ -f "$WORKTREE_STATE_FILE" ]]; then
        local existing_path=$(jq -r '.sandbox_path // empty' "$WORKTREE_STATE_FILE" 2>/dev/null)
        if [[ -n "$existing_path" ]] && [[ -d "$existing_path" ]]; then
            log_warn "Existing sandbox found: $existing_path"
            log_info "Use 'loki sandbox stop' to stop it first."
            return 1
        fi
    fi

    # Create branch for sandbox
    if ! git branch "$sandbox_branch" HEAD 2>/dev/null; then
        log_error "Failed to create sandbox branch. Are you in a git repository?"
        return 1
    fi

    # Create worktree
    if ! git worktree add "$sandbox_path" "$sandbox_branch" 2>/dev/null; then
        git branch -D "$sandbox_branch" 2>/dev/null
        log_error "Failed to create worktree at $sandbox_path"
        return 1
    fi

    # Set up sandbox environment
    mkdir -p "$sandbox_path/.loki/"{state,logs,signals,queue,memory}

    # Copy essential files
    for file in ".loki/CONTINUITY.md" ".loki/config.yaml" "SKILL.md" "CLAUDE.md"; do
        if [[ -f "$PROJECT_DIR/$file" ]]; then
            mkdir -p "$(dirname "$sandbox_path/$file")"
            cp "$PROJECT_DIR/$file" "$sandbox_path/$file" 2>/dev/null || true
        fi
    done

    # Create sandbox marker
    cat > "$sandbox_path/.loki/SANDBOX_MODE" << EOF
ISOLATION_TYPE=worktree
CREATED_AT=$(date -Iseconds)
PARENT_DIR=$PROJECT_DIR
EOF

    # Save state
    mkdir -p "$(dirname "$WORKTREE_STATE_FILE")"
    cat > "$WORKTREE_STATE_FILE" << EOF
{
    "sandbox_path": "$sandbox_path",
    "sandbox_branch": "$sandbox_branch",
    "created_at": "$(date -Iseconds)",
    "provider": "$provider",
    "prd_path": "$prd_path",
    "status": "created",
    "isolation_type": "worktree"
}
EOF

    log_success "Worktree sandbox created: $sandbox_path"
    return 0
}

# Start loki in worktree sandbox
start_worktree_sandbox() {
    local prd_path="${1:-}"
    local provider="${LOKI_PROVIDER:-claude}"

    # Create sandbox if needed
    if ! [[ -f "$WORKTREE_STATE_FILE" ]]; then
        create_worktree_sandbox "$prd_path" || return 1
    fi

    local sandbox_path=$(jq -r '.sandbox_path' "$WORKTREE_STATE_FILE")

    if [[ ! -d "$sandbox_path" ]]; then
        log_error "Sandbox path does not exist: $sandbox_path"
        rm -f "$WORKTREE_STATE_FILE"
        return 1
    fi

    log_info "Starting Loki in worktree sandbox..."
    log_info "  Path:     $sandbox_path"
    log_info "  Provider: $provider"

    # Build loki command
    local loki_cmd="$SKILL_DIR/autonomy/run.sh"
    if [[ -n "$prd_path" ]]; then
        if [[ -f "$sandbox_path/$prd_path" ]]; then
            loki_cmd="$loki_cmd $prd_path"
        elif [[ -f "$prd_path" ]]; then
            cp "$prd_path" "$sandbox_path/" 2>/dev/null || true
            loki_cmd="$loki_cmd $(basename "$prd_path")"
        fi
    fi
    loki_cmd="$loki_cmd --provider $provider"

    # Set environment
    export LOKI_SANDBOX_MODE=true
    export LOKI_SANDBOX_TYPE=worktree
    export LOKI_NOTIFICATIONS=false

    log_info ""
    log_info "Commands (in another terminal):"
    log_info "  loki sandbox status      - Check status"
    log_info "  loki sandbox prompt 'msg' - Send prompt"
    log_info "  loki sandbox stop        - Stop sandbox"
    log_info ""

    # Run loki in sandbox directory
    cd "$sandbox_path" && $loki_cmd
}

# Stop worktree sandbox
stop_worktree_sandbox() {
    if [[ ! -f "$WORKTREE_STATE_FILE" ]]; then
        log_warn "No active worktree sandbox found"
        return 0
    fi

    local sandbox_path=$(jq -r '.sandbox_path' "$WORKTREE_STATE_FILE")
    local sandbox_branch=$(jq -r '.sandbox_branch' "$WORKTREE_STATE_FILE")

    log_info "Stopping worktree sandbox..."

    # Send stop signal
    if [[ -d "$sandbox_path" ]]; then
        touch "$sandbox_path/.loki/STOP" 2>/dev/null || true
    fi

    # Cleanup
    if [[ "${LOKI_SANDBOX_CLEANUP:-true}" == "true" ]]; then
        log_info "Cleaning up worktree..."

        if [[ -n "$sandbox_path" ]] && [[ -d "$sandbox_path" ]]; then
            git worktree remove "$sandbox_path" --force 2>/dev/null || rm -rf "$sandbox_path" 2>/dev/null
        fi

        if [[ -n "$sandbox_branch" ]]; then
            git branch -D "$sandbox_branch" 2>/dev/null || true
        fi

        git worktree prune 2>/dev/null || true
        rm -f "$WORKTREE_STATE_FILE"

        log_success "Worktree sandbox cleaned up"
    else
        log_info "Sandbox preserved at: $sandbox_path"
        log_info "Run 'loki sandbox cleanup' to remove."
    fi
}

# Worktree sandbox status
worktree_sandbox_status() {
    if [[ ! -f "$WORKTREE_STATE_FILE" ]]; then
        log_info "No active worktree sandbox"
        return 0
    fi

    local sandbox_path=$(jq -r '.sandbox_path' "$WORKTREE_STATE_FILE")
    local sandbox_branch=$(jq -r '.sandbox_branch' "$WORKTREE_STATE_FILE")
    local created_at=$(jq -r '.created_at' "$WORKTREE_STATE_FILE")

    echo ""
    echo -e "${BOLD}Worktree Sandbox Status${NC}"
    echo "========================"
    echo ""
    echo -e "  Path:    ${CYAN}$sandbox_path${NC}"
    echo -e "  Branch:  $sandbox_branch"
    echo -e "  Created: $created_at"

    if [[ -d "$sandbox_path" ]]; then
        local disk_usage=$(du -sh "$sandbox_path" 2>/dev/null | cut -f1)
        echo -e "  Disk:    $disk_usage"

        if [[ -f "$sandbox_path/.loki/STOP" ]]; then
            echo -e "  Status:  ${YELLOW}Stopping${NC}"
        else
            echo -e "  Status:  ${GREEN}Active${NC}"
        fi
    else
        echo -e "  Status:  ${RED}Missing${NC}"
    fi

    echo ""
    echo -e "${YELLOW}[SOFT ISOLATION]${NC} - No filesystem/network/process isolation"
    echo ""
}

# Send prompt to worktree sandbox
worktree_sandbox_prompt() {
    local prompt="$*"

    # Security check: prompt injection disabled by default
    if [[ "$PROMPT_INJECTION_ENABLED" != "true" ]]; then
        log_error "Prompt injection is disabled for security"
        log_info ""
        log_info "To enable, set LOKI_PROMPT_INJECTION=true"
        log_info "  Example: LOKI_PROMPT_INJECTION=true loki sandbox prompt 'your message'"
        log_info ""
        log_warn "WARNING: Only enable in trusted environments"
        return 1
    fi

    if [[ -z "$prompt" ]]; then
        log_error "Usage: loki sandbox prompt <your message>"
        return 1
    fi

    if [[ ! -f "$WORKTREE_STATE_FILE" ]]; then
        log_error "No active worktree sandbox"
        return 1
    fi

    local sandbox_path=$(jq -r '.sandbox_path' "$WORKTREE_STATE_FILE")

    if [[ ! -d "$sandbox_path" ]]; then
        log_error "Sandbox path does not exist"
        return 1
    fi

    # Use printf to safely write prompt without interpretation
    printf '%s\n' "$prompt" > "$sandbox_path/.loki/HUMAN_INPUT.md"
    log_success "Prompt sent to worktree sandbox"
    log_info "Check $sandbox_path/.loki/logs/ for response"
}

# Cleanup orphaned worktrees
cleanup_worktrees() {
    log_info "Scanning for orphaned sandbox worktrees..."

    local found=0
    while IFS= read -r line; do
        if [[ "$line" == *"$WORKTREE_PREFIX"* ]]; then
            log_info "  Found: $line"
            ((found++))
        fi
    done < <(git worktree list 2>/dev/null)

    if [[ $found -eq 0 ]]; then
        log_info "No sandbox worktrees found"
        return 0
    fi

    log_info "Pruning worktrees..."
    git worktree prune 2>/dev/null || true

    # Clean up orphaned branches
    local branches=$(git branch --list "${WORKTREE_PREFIX}*" 2>/dev/null)
    while IFS= read -r branch; do
        branch=$(echo "$branch" | tr -d '* ')
        if [[ -n "$branch" ]]; then
            log_info "  Removing branch: $branch"
            git branch -D "$branch" 2>/dev/null || true
        fi
    done <<< "$branches"

    rm -f "$WORKTREE_STATE_FILE" 2>/dev/null
    log_success "Cleanup complete"
}

#===============================================================================
# Container Management
#===============================================================================

start_sandbox() {
    local prd_path="${1:-}"
    local provider="${LOKI_PROVIDER:-claude}"

    # Set up signal handler to cleanup on Ctrl+C
    trap cleanup_container INT TERM

    check_docker
    validate_project_dir || return 1
    ensure_image

    # Check port availability
    if ! check_port_available "$API_PORT"; then
        log_error "Port $API_PORT is already in use"
        log_info "Set LOKI_API_PORT to use a different port"
        return 1
    fi
    if ! check_port_available "$DASHBOARD_PORT"; then
        log_error "Port $DASHBOARD_PORT is already in use"
        log_info "Set LOKI_DASHBOARD_PORT to use a different port"
        return 1
    fi

    # Warn about missing API keys
    warn_missing_api_keys "$provider"

    # Warn about network=none implications
    if [[ "$SANDBOX_NETWORK" == "none" ]]; then
        log_warn "Network disabled (--network=none)"
        log_warn "  - Git remote operations will fail"
        log_warn "  - Package installations will fail"
        log_warn "  - API calls to AI providers will fail"
    fi

    # Check if already running
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_warn "Sandbox already running: $CONTAINER_NAME"
        log_info "Use 'loki sandbox status' to check or 'loki sandbox stop' to stop"
        return 0
    fi

    # Clean up any stopped container with same name
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

    log_info "Starting sandbox container..."
    log_info "  Image:    $SANDBOX_IMAGE"
    log_info "  Project:  $PROJECT_DIR"
    log_info "  Provider: $provider"
    log_info "  Network:  $SANDBOX_NETWORK"
    log_info "  CPUs:     $SANDBOX_CPUS"
    log_info "  Memory:   $SANDBOX_MEMORY"

    # Build docker run command
    local docker_args=(
        "run"
        "--name" "$CONTAINER_NAME"
        "--detach"
        "--interactive"
        "--tty"

        # Resource limits
        "--cpus=$SANDBOX_CPUS"
        "--memory=$SANDBOX_MEMORY"
        "--memory-swap=$SANDBOX_MEMORY"  # Disable swap
        "--pids-limit=256"

        # Security hardening
        "--security-opt=no-new-privileges:true"
        "--cap-drop=ALL"
        "--cap-add=CHOWN"
        "--cap-add=SETUID"
        "--cap-add=SETGID"

        # Network
        "--network=$SANDBOX_NETWORK"
    )

    # Add seccomp profile if available
    local seccomp_profile="$SKILL_DIR/autonomy/seccomp-sandbox.json"
    if [[ -f "$seccomp_profile" ]]; then
        docker_args+=("--security-opt" "seccomp=$seccomp_profile")
        log_info "  Seccomp:  enabled"
    fi

    # Mount project directory
    if [[ "$SANDBOX_READONLY" == "true" ]]; then
        docker_args+=("--volume" "$PROJECT_DIR:/workspace:ro")
        # Need a writable .loki directory
        docker_args+=("--volume" "loki-sandbox-state:/workspace/.loki:rw")
    else
        docker_args+=("--volume" "$PROJECT_DIR:/workspace:rw")
    fi

    # Mount git config (read-only) - mount to /home/loki since container runs as user loki
    if [[ -f "$HOME/.gitconfig" ]]; then
        docker_args+=("--volume" "$HOME/.gitconfig:/home/loki/.gitconfig:ro")
    fi

    # SSH agent forwarding (more secure than mounting .ssh directory)
    # Only forward if SSH agent is available
    if [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
        docker_args+=("--volume" "$SSH_AUTH_SOCK:/ssh-agent:ro")
        docker_args+=("--env" "SSH_AUTH_SOCK=/ssh-agent")
    elif [[ -d "$HOME/.ssh" ]]; then
        # Fallback: mount only known_hosts and public keys (NOT private keys)
        if [[ -f "$HOME/.ssh/known_hosts" ]]; then
            docker_args+=("--volume" "$HOME/.ssh/known_hosts:/home/loki/.ssh/known_hosts:ro")
        fi
        log_warn "SSH agent not available. Git operations may require manual auth."
    fi

    # Mount GitHub CLI config (read-only) - mount to /home/loki since container runs as user loki
    if [[ -d "$HOME/.config/gh" ]]; then
        docker_args+=("--volume" "$HOME/.config/gh:/home/loki/.config/gh:ro")
    fi

    # Pass API keys as environment variables (more secure than mounting files)
    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        docker_args+=("--env" "ANTHROPIC_API_KEY")
    fi
    if [[ -n "${OPENAI_API_KEY:-}" ]]; then
        docker_args+=("--env" "OPENAI_API_KEY")
    fi
    if [[ -n "${GOOGLE_API_KEY:-}" ]]; then
        docker_args+=("--env" "GOOGLE_API_KEY")
    fi
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        docker_args+=("--env" "GITHUB_TOKEN")
    fi
    if [[ -n "${GH_TOKEN:-}" ]]; then
        docker_args+=("--env" "GH_TOKEN")
    fi

    # Loki configuration
    docker_args+=(
        "--env" "LOKI_PROVIDER=$provider"
        "--env" "LOKI_SANDBOX_MODE=true"
        "--env" "LOKI_NOTIFICATIONS=false"
        "--env" "LOKI_DASHBOARD=true"
    )

    # Expose ports
    docker_args+=(
        "--publish" "$API_PORT:9898"
        "--publish" "$DASHBOARD_PORT:57374"
    )

    # Expose additional ports for testing (e.g., LOKI_EXTRA_PORTS="3000:3000,8080:8080")
    if [[ -n "${LOKI_EXTRA_PORTS:-}" ]]; then
        IFS=',' read -ra EXTRA_PORTS <<< "$LOKI_EXTRA_PORTS"
        for port_mapping in "${EXTRA_PORTS[@]}"; do
            docker_args+=("--publish" "$port_mapping")
        done
    fi

    # Working directory
    docker_args+=("--workdir" "/workspace")

    # Override entrypoint to use bash (Dockerfile has loki as entrypoint)
    docker_args+=("--entrypoint" "/bin/bash")

    # Image and command
    docker_args+=("$SANDBOX_IMAGE")

    # Build loki command
    local loki_cmd="loki start"
    if [[ -n "$prd_path" ]]; then
        # Convert to container path (handle paths with spaces)
        local relative_prd
        relative_prd=$(realpath --relative-to="$PROJECT_DIR" "$prd_path" 2>/dev/null || basename "$prd_path")
        local container_prd="/workspace/${relative_prd}"
        # Quote path to handle spaces
        loki_cmd="$loki_cmd \"$container_prd\""
    fi
    loki_cmd="$loki_cmd --provider $provider"

    docker_args+=("-c" "$loki_cmd")

    # Run container
    local container_id
    container_id=$(docker "${docker_args[@]}")

    log_success "Sandbox started: ${container_id:0:12}"
    log_info ""
    log_info "Access:"
    log_info "  Dashboard: http://localhost:$DASHBOARD_PORT"
    log_info "  API:       http://localhost:$API_PORT"
    if [[ -n "${LOKI_EXTRA_PORTS:-}" ]]; then
        log_info "  Extra:     $LOKI_EXTRA_PORTS"
    fi
    log_info ""
    log_info "Commands:"
    log_info "  loki sandbox logs       - View logs"
    log_info "  loki sandbox shell      - Open shell in container"
    log_info "  loki sandbox stop       - Stop sandbox"
    log_info ""
    log_info "Testing (when ready):"
    log_info "  loki sandbox phase      - Check SDLC phase & testing tips"
    log_info "  loki sandbox test       - Run tests"
    log_info "  loki sandbox serve      - Start dev server"
    log_info "  loki sandbox prompt 'msg' - Send real-time prompt"
}

stop_sandbox() {
    check_docker

    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_info "Stopping sandbox: $CONTAINER_NAME"

        # Try graceful stop first (touch STOP file)
        docker exec "$CONTAINER_NAME" touch /workspace/.loki/STOP 2>/dev/null || true

        # Wait for graceful shutdown (check every second for up to 10 seconds)
        local waited=0
        while [ $waited -lt 10 ]; do
            if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
                log_success "Sandbox stopped gracefully"
                return 0
            fi
            sleep 1
            ((waited++))
        done

        # Force stop if still running
        log_info "Force stopping container..."
        docker stop --time 5 "$CONTAINER_NAME" 2>/dev/null || true
        docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

        log_success "Sandbox stopped"
    else
        log_warn "No running sandbox found"
    fi
}

# Send a prompt/directive to the running sandbox
sandbox_prompt() {
    local prompt="$*"

    # Security check: prompt injection disabled by default
    if [[ "$PROMPT_INJECTION_ENABLED" != "true" ]]; then
        log_error "Prompt injection is disabled for security"
        log_info ""
        log_info "To enable, set LOKI_PROMPT_INJECTION=true"
        log_info "  Example: LOKI_PROMPT_INJECTION=true loki sandbox prompt 'your message'"
        log_info ""
        log_warn "WARNING: Only enable in trusted environments"
        return 1
    fi

    if [[ -z "$prompt" ]]; then
        log_error "Usage: loki sandbox prompt <your message>"
        log_info "Example: loki sandbox prompt 'start the dev server and show me the URL'"
        return 1
    fi

    check_docker

    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "Sandbox is not running. Start it first with: loki sandbox start"
        return 1
    fi

    log_info "Sending prompt to sandbox..."

    # Write to HUMAN_INPUT.md inside the container
    # Use heredoc to avoid command injection via single quotes in prompt
    docker exec "$CONTAINER_NAME" bash -c 'cat > /workspace/.loki/HUMAN_INPUT.md' <<< "$prompt"

    log_success "Prompt sent. Loki will process it in the next iteration."
    log_info ""
    log_info "Watch the response with: loki sandbox logs"
    log_info "Or check status with: loki sandbox status"
}

# Run a command inside the sandbox and show output
sandbox_run() {
    local cmd="$*"

    if [[ -z "$cmd" ]]; then
        log_error "Usage: loki sandbox run <command>"
        log_info "Example: loki sandbox run 'npm run dev'"
        return 1
    fi

    check_docker

    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "Sandbox is not running"
        return 1
    fi

    log_info "Running command in sandbox: $cmd"
    docker exec -it "$CONTAINER_NAME" bash -c "cd /workspace && $cmd"
}

# Start a dev server inside the sandbox
sandbox_serve() {
    local port="${1:-3000}"

    check_docker

    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "Sandbox is not running"
        return 1
    fi

    log_info "Looking for dev server configuration..."

    # Detect project type and start appropriate server
    local serve_cmd=""

    if docker exec "$CONTAINER_NAME" test -f /workspace/package.json; then
        # Check for common dev server scripts
        local has_dev=$(docker exec "$CONTAINER_NAME" jq -r '.scripts.dev // empty' /workspace/package.json 2>/dev/null)
        local has_start=$(docker exec "$CONTAINER_NAME" jq -r '.scripts.start // empty' /workspace/package.json 2>/dev/null)

        if [[ -n "$has_dev" ]]; then
            serve_cmd="npm run dev"
        elif [[ -n "$has_start" ]]; then
            serve_cmd="npm start"
        fi
    elif docker exec "$CONTAINER_NAME" test -f /workspace/requirements.txt; then
        # Python project
        if docker exec "$CONTAINER_NAME" test -f /workspace/manage.py; then
            serve_cmd="python manage.py runserver 0.0.0.0:$port"
        elif docker exec "$CONTAINER_NAME" test -f /workspace/app.py; then
            serve_cmd="python app.py"
        fi
    fi

    if [[ -z "$serve_cmd" ]]; then
        log_warn "Could not auto-detect dev server"
        log_info "Try: loki sandbox run 'your-dev-command'"
        return 1
    fi

    log_success "Starting dev server: $serve_cmd"
    log_info ""
    log_info "Access the app at:"
    log_info "  http://localhost:$port"
    log_info ""
    log_info "Press Ctrl+C to stop the server (sandbox continues running)"

    docker exec -it "$CONTAINER_NAME" bash -c "cd /workspace && $serve_cmd"
}

# Run tests inside the sandbox
sandbox_test() {
    local test_type="${1:-all}"

    check_docker

    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "Sandbox is not running"
        return 1
    fi

    log_info "Running tests in sandbox..."

    # Detect project type and test command
    local test_cmd=""

    if docker exec "$CONTAINER_NAME" test -f /workspace/package.json; then
        case "$test_type" in
            unit)
                test_cmd=$(docker exec "$CONTAINER_NAME" jq -r '.scripts["test:unit"] // .scripts.test // "npm test"' /workspace/package.json 2>/dev/null)
                ;;
            integration)
                test_cmd=$(docker exec "$CONTAINER_NAME" jq -r '.scripts["test:integration"] // empty' /workspace/package.json 2>/dev/null)
                [[ -z "$test_cmd" ]] && test_cmd="npm run test:integration"
                ;;
            e2e)
                if docker exec "$CONTAINER_NAME" test -d /workspace/node_modules/.bin/playwright; then
                    test_cmd="npx playwright test"
                elif docker exec "$CONTAINER_NAME" test -d /workspace/node_modules/.bin/cypress; then
                    test_cmd="npx cypress run"
                else
                    test_cmd=$(docker exec "$CONTAINER_NAME" jq -r '.scripts["test:e2e"] // empty' /workspace/package.json 2>/dev/null)
                fi
                ;;
            all|*)
                test_cmd=$(docker exec "$CONTAINER_NAME" jq -r '.scripts.test // "npm test"' /workspace/package.json 2>/dev/null)
                ;;
        esac
    elif docker exec "$CONTAINER_NAME" test -f /workspace/requirements.txt; then
        case "$test_type" in
            unit)
                test_cmd="pytest tests/unit/ -v"
                ;;
            integration)
                test_cmd="pytest tests/integration/ -v"
                ;;
            e2e)
                test_cmd="pytest tests/e2e/ -v"
                ;;
            all|*)
                test_cmd="pytest -v"
                ;;
        esac
    elif docker exec "$CONTAINER_NAME" test -f /workspace/Cargo.toml; then
        test_cmd="cargo test"
    elif docker exec "$CONTAINER_NAME" test -f /workspace/go.mod; then
        test_cmd="go test ./..."
    fi

    if [[ -z "$test_cmd" ]] || [[ "$test_cmd" == "null" ]]; then
        log_warn "Could not auto-detect test command"
        log_info "Supported test types: unit, integration, e2e, all"
        log_info "Or run: loki sandbox run 'your-test-command'"
        return 1
    fi

    log_success "Running: $test_cmd"
    docker exec -it "$CONTAINER_NAME" bash -c "cd /workspace && $test_cmd"
}

# Check SDLC phase and suggest testing
sandbox_phase() {
    check_docker

    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "Sandbox is not running"
        return 1
    fi

    # Get current phase from orchestrator state
    local phase=$(docker exec "$CONTAINER_NAME" bash -c \
        "python3 -c \"import json; print(json.load(open('/workspace/.loki/state/orchestrator.json')).get('currentPhase', 'UNKNOWN'))\" 2>/dev/null" \
        || echo "UNKNOWN")

    echo ""
    echo -e "${BOLD}Current SDLC Phase: ${CYAN}$phase${NC}"
    echo ""

    case "$phase" in
        BOOTSTRAP|DISCOVERY|ARCHITECTURE)
            log_info "Phase $phase - No testing required yet"
            log_info "Testing begins in DEVELOPMENT phase"
            ;;
        INFRASTRUCTURE)
            log_info "Phase $phase - Infrastructure testing"
            echo "  Recommended:"
            echo "    loki sandbox run 'docker-compose up -d'"
            echo "    loki sandbox run 'terraform plan'"
            ;;
        DEVELOPMENT)
            log_info "Phase $phase - Development testing recommended"
            echo ""
            echo "  Run dev server:"
            echo "    loki sandbox serve"
            echo ""
            echo "  Run unit tests:"
            echo "    loki sandbox test unit"
            echo ""
            echo "  Manual testing:"
            echo "    loki sandbox shell"
            ;;
        QA)
            log_info "Phase $phase - Full testing required"
            echo ""
            echo "  Run all tests:"
            echo "    loki sandbox test all"
            echo ""
            echo "  Run specific test suites:"
            echo "    loki sandbox test unit"
            echo "    loki sandbox test integration"
            echo "    loki sandbox test e2e"
            echo ""
            echo "  Interactive testing:"
            echo "    loki sandbox serve"
            echo "    loki sandbox shell"
            echo ""
            echo "  To report issues during testing:"
            echo "    loki sandbox prompt 'Found bug: describe the bug here'"
            ;;
        DEPLOYMENT)
            log_info "Phase $phase - Smoke testing"
            echo ""
            echo "  Run smoke tests:"
            echo "    loki sandbox run 'npm run test:smoke'"
            echo ""
            echo "  Check deployment status:"
            echo "    loki sandbox run 'curl -s http://localhost:3000/health'"
            ;;
        GROWTH|*)
            log_info "Phase $phase - Continuous testing"
            echo ""
            echo "  Run regression tests:"
            echo "    loki sandbox test all"
            echo ""
            echo "  Performance testing:"
            echo "    loki sandbox run 'npx k6 run tests/load.js'"
            ;;
    esac

    echo ""
}

# Expose additional ports (for development testing)
sandbox_expose() {
    local port="${1:-}"

    if [[ -z "$port" ]]; then
        log_error "Usage: loki sandbox expose <port>"
        log_info "Example: loki sandbox expose 8080"
        return 1
    fi

    check_docker

    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "Sandbox is not running"
        log_info "Note: Ports must be exposed when starting the sandbox"
        log_info "Set LOKI_EXTRA_PORTS='$port:$port' before running 'loki sandbox start'"
        return 1
    fi

    log_warn "Cannot expose ports on running container"
    log_info ""
    log_info "To expose additional ports, restart sandbox with:"
    echo ""
    echo "  LOKI_EXTRA_PORTS='$port:$port' loki sandbox start"
    echo ""
    log_info "Or access via sandbox shell:"
    echo "  loki sandbox shell"
    echo "  # Then run your server inside the container"
}

sandbox_status() {
    check_docker

    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_success "Sandbox is running: $CONTAINER_NAME"
        echo ""
        docker ps --filter "name=$CONTAINER_NAME" --format "table {{.ID}}\t{{.Status}}\t{{.Ports}}"
        echo ""

        # Try to get loki status
        log_info "Loki Status:"
        docker exec "$CONTAINER_NAME" loki status 2>/dev/null || log_warn "Could not get loki status"
    else
        log_warn "Sandbox is not running"

        # Check for stopped container
        if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
            log_info "Stopped container exists. Use 'loki sandbox start' to restart."
        fi
    fi
}

sandbox_logs() {
    local lines="${1:-100}"
    check_docker

    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker logs --tail "$lines" -f "$CONTAINER_NAME"
    else
        log_error "Sandbox is not running"
        exit 1
    fi
}

sandbox_shell() {
    check_docker

    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_info "Opening shell in sandbox..."
        docker exec -it "$CONTAINER_NAME" bash
    else
        log_error "Sandbox is not running"
        exit 1
    fi
}

sandbox_build() {
    check_docker
    build_sandbox_image
}

show_help() {
    echo -e "${BOLD}Loki Mode Sandbox${NC}"
    echo ""
    echo "Usage: loki sandbox <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start [PRD]      Start sandbox with optional PRD"
    echo "  stop             Stop running sandbox"
    echo "  status           Check sandbox status"
    echo "  logs [N]         View last N log lines (default: 100)"
    echo "  shell            Open bash shell in sandbox"
    echo "  build            Build/rebuild sandbox image"
    echo "  cleanup          Remove orphaned sandbox worktrees/branches"
    echo ""
    echo "Interactive Commands (while sandbox is running):"
    echo "  prompt <msg>     Send a prompt/directive to Loki in real-time"
    echo "  run <cmd>        Run a command inside the sandbox"
    echo "  serve [port]     Auto-detect and start dev server (default port: 3000)"
    echo ""
    echo "Testing Commands:"
    echo "  test [type]      Run tests (type: unit, integration, e2e, all)"
    echo "  phase            Check SDLC phase and get testing suggestions"
    echo "  expose <port>    Show how to expose additional ports"
    echo ""
    echo "Mode Options:"
    echo "  --docker         Force Docker sandbox (full isolation)"
    echo "  --worktree       Force git worktree sandbox (soft isolation)"
    echo "  --auto           Auto-detect best mode (default)"
    echo ""
    echo "Sandbox Modes:"
    echo "  Docker (default) - Full isolation with seccomp, dropped capabilities,"
    echo "                     resource limits, network control"
    echo "  Worktree         - Git worktree isolation (fallback if Docker unavailable)"
    echo "                     Warning: No filesystem/network/process isolation"
    echo ""
    echo "Environment Variables:"
    echo "  LOKI_SANDBOX_IMAGE    Docker image (default: loki-mode:sandbox)"
    echo "  LOKI_SANDBOX_NETWORK  Network mode: bridge, none, host (default: bridge)"
    echo "  LOKI_SANDBOX_CPUS     CPU limit (default: 2)"
    echo "  LOKI_SANDBOX_MEMORY   Memory limit (default: 4g)"
    echo "  LOKI_SANDBOX_READONLY Mount project read-only (default: false)"
    echo "  LOKI_SANDBOX_CLEANUP  Auto-cleanup worktree on stop (default: true)"
    echo "  LOKI_EXTRA_PORTS      Expose extra ports (e.g., '3000:3000,8080:8080')"
    echo "  LOKI_PROMPT_INJECTION Enable real-time prompts (default: false)"
    echo ""
    echo "Security Features (Docker mode):"
    echo "  - Seccomp profile restricts syscalls"
    echo "  - No new privileges flag"
    echo "  - Dropped capabilities"
    echo "  - Resource limits (CPU, memory, PIDs)"
    echo "  - API keys passed as env vars (not mounted)"
    echo "  - Prompt injection DISABLED by default (enterprise security)"
    echo ""
    echo "Examples:"
    echo "  loki sandbox start                              # Start (auto-detect mode)"
    echo "  loki sandbox start --docker ./prd.md           # Force Docker mode"
    echo "  loki sandbox start --worktree                   # Force worktree mode"
    echo "  loki sandbox prompt 'start the app and show URL'  # Send prompt"
    echo "  loki sandbox serve                              # Start dev server"
    echo "  loki sandbox test                               # Run all tests"
    echo "  loki sandbox test unit                          # Run unit tests only"
    echo "  loki sandbox phase                              # Check phase, get testing tips"
    echo "  loki sandbox run 'npm test'                     # Run custom command"
    echo "  loki sandbox cleanup                            # Remove old worktrees"
}

#===============================================================================
# Main
#===============================================================================

main() {
    local command="${1:-help}"
    shift || true

    # Parse mode option
    local mode="auto"
    local args=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --docker) mode="docker"; shift ;;
            --worktree) mode="worktree"; shift ;;
            --auto) mode="auto"; shift ;;
            *) args+=("$1"); shift ;;
        esac
    done

    # Detect sandbox mode for commands that need it
    local sandbox_mode=""
    case "$command" in
        start|stop|status|prompt)
            sandbox_mode=$(detect_sandbox_mode "$mode") || exit 1
            ;;
    esac

    case "$command" in
        start)
            if [[ "$sandbox_mode" == "docker" ]]; then
                start_sandbox ${args[@]+"${args[@]}"}
            else
                start_worktree_sandbox ${args[@]+"${args[@]}"}
            fi
            ;;
        stop)
            if [[ "$sandbox_mode" == "docker" ]]; then
                stop_sandbox
            else
                stop_worktree_sandbox
            fi
            ;;
        status)
            if [[ "$sandbox_mode" == "docker" ]]; then
                sandbox_status
            else
                worktree_sandbox_status
            fi
            ;;
        logs)
            sandbox_logs ${args[@]+"${args[@]}"}
            ;;
        shell)
            sandbox_shell
            ;;
        build)
            sandbox_build
            ;;
        prompt)
            if [[ "$sandbox_mode" == "docker" ]]; then
                sandbox_prompt ${args[@]+"${args[@]}"}
            else
                worktree_sandbox_prompt ${args[@]+"${args[@]}"}
            fi
            ;;
        run)
            sandbox_run ${args[@]+"${args[@]}"}
            ;;
        cleanup)
            cleanup_worktrees
            ;;
        serve)
            sandbox_serve ${args[@]+"${args[@]}"}
            ;;
        test)
            sandbox_test ${args[@]+"${args[@]}"}
            ;;
        phase)
            sandbox_phase
            ;;
        expose)
            sandbox_expose ${args[@]+"${args[@]}"}
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
