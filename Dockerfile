# Dockerfile for herdctl Docker runtime
#
# This image provides a containerized environment for running Claude Code agents
# via the CLI runtime. It includes Node.js and the Claude CLI.

FROM node:22-slim

# Install system dependencies and GitHub CLI
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    curl \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI and Agent SDK globally
RUN npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk

# Copy SDK wrapper script for Docker SDK runtime
COPY packages/core/src/runner/runtime/docker-sdk-wrapper.js /usr/local/lib/docker-sdk-wrapper.js
RUN chmod +x /usr/local/lib/docker-sdk-wrapper.js

# Create entrypoint script that configures git with GITHUB_TOKEN if present
RUN printf '#!/bin/sh\n\
if [ -n "$GITHUB_TOKEN" ]; then\n\
  git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"\n\
fi\n\
exec "$@"\n' > /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

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
