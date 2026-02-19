#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_NAME="$(basename "$REPO_DIR")"
WORKTREES_DIR="$(dirname "$REPO_DIR")/${REPO_NAME}-worktrees"

usage() {
  cat <<EOF
Git worktree helper for herdctl development.

Worktrees are created as siblings of the repo to avoid Node module
resolution and file watcher issues that occur with nested worktrees.

  Repo:       $REPO_DIR
  Worktrees:  $WORKTREES_DIR

Usage: $(basename "$0") <command> [options]

Commands:
  add <name> [--from <branch>]   Create a new worktree with a new branch
  list                           List all worktrees
  remove <name>                  Remove a worktree (keeps the branch)
  path <name>                    Print the path to a worktree

Examples:
  $(basename "$0") add feature/web-auth          # New branch, based on current HEAD
  $(basename "$0") add fix/scheduler --from main # New branch, based on main
  $(basename "$0") remove feature/web-auth       # Remove worktree, keep branch
  $(basename "$0") list                          # Show all worktrees
EOF
}

dir_name_from_branch() {
  # Convert branch name to directory-safe name: feature/web-auth -> feature-web-auth
  echo "$1" | tr '/' '-'
}

cmd_add() {
  local branch_name="$1"
  local from_branch=""
  shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from|-f)
        from_branch="$2"
        shift 2
        ;;
      *)
        echo "Unknown option: $1"
        exit 1
        ;;
    esac
  done

  local dir_name
  dir_name="$(dir_name_from_branch "$branch_name")"
  local worktree_path="$WORKTREES_DIR/$dir_name"

  if [ -d "$worktree_path" ]; then
    echo "Error: Worktree already exists at $worktree_path"
    exit 1
  fi

  mkdir -p "$WORKTREES_DIR"

  if [ -n "$from_branch" ]; then
    git -C "$REPO_DIR" worktree add -b "$branch_name" "$worktree_path" "$from_branch"
  else
    git -C "$REPO_DIR" worktree add -b "$branch_name" "$worktree_path"
  fi

  echo ""
  echo "Installing dependencies..."
  (cd "$worktree_path" && pnpm install)

  echo ""
  echo "Worktree ready:"
  echo "  Branch: $branch_name"
  echo "  Path:   $worktree_path"
  echo ""
  echo "To start working:"
  echo "  cd $worktree_path"
}

cmd_list() {
  git -C "$REPO_DIR" worktree list
}

cmd_remove() {
  local name="$1"
  local dir_name
  dir_name="$(dir_name_from_branch "$name")"
  local worktree_path="$WORKTREES_DIR/$dir_name"

  if [ ! -d "$worktree_path" ]; then
    echo "Error: No worktree at $worktree_path"
    echo ""
    echo "Current worktrees:"
    cmd_list
    exit 1
  fi

  git -C "$REPO_DIR" worktree remove "$worktree_path"
  echo "Worktree removed: $dir_name"
  echo "Branch '$name' still exists. To delete it: git branch -d $name"
}

cmd_path() {
  local name="$1"
  local dir_name
  dir_name="$(dir_name_from_branch "$name")"
  echo "$WORKTREES_DIR/$dir_name"
}

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

command="$1"
shift

case "$command" in
  add)
    if [ $# -lt 1 ]; then
      echo "Error: 'add' requires a branch name"
      echo ""
      usage
      exit 1
    fi
    cmd_add "$@"
    ;;
  list|ls)
    cmd_list
    ;;
  remove|rm)
    if [ $# -lt 1 ]; then
      echo "Error: 'remove' requires a name"
      echo ""
      usage
      exit 1
    fi
    cmd_remove "$@"
    ;;
  path)
    if [ $# -lt 1 ]; then
      echo "Error: 'path' requires a name"
      echo ""
      usage
      exit 1
    fi
    cmd_path "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $command"
    echo ""
    usage
    exit 1
    ;;
esac
