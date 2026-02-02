# Dockerfile for herdctl Docker runtime
#
# This image provides a containerized environment for running Claude Code agents
# via the CLI runtime. It includes Node.js and the Claude CLI.

FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create directories that Claude CLI will need to write to
# Make them world-writable so any UID can use them (container isolation provides security)
RUN mkdir -p /home/claude/.claude/projects && \
    chmod -R 777 /home/claude

# Create workspace directory writable by any user
RUN mkdir -p /workspace && chmod 777 /workspace
WORKDIR /workspace

# The Claude CLI will be executed via docker exec as non-root user (via --user flag)
# Container stays running but exec commands run as the host user's UID for security
CMD ["tail", "-f", "/dev/null"]
