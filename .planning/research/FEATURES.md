# Feature Research: Runtime Abstraction & Docker Containerization

**Domain:** Agent orchestration runtime abstraction and containerized execution
**Researched:** 2026-01-31
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

#### Runtime Abstraction Layer

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Transparent backend switching** | Users expect abstraction layers to swap backends without code changes | MEDIUM | AnyIO (2026) demonstrated 40% performance gains with zero-code-change AsyncIO/Trio switching. Pattern: pluggable adapter architecture. |
| **Unified interface** | Single API regardless of backend (SDK vs CLI) | LOW | Standard adapter pattern - define common interface, implement per backend |
| **Configuration-driven selection** | Runtime choice via config, not hardcoded | LOW | Example: `runtime: { type: "sdk" }` or `runtime: { type: "cli" }` in agent config |
| **Automatic fallback** | If preferred runtime unavailable, gracefully fallback | MEDIUM | Check SDK availability → try CLI → fail with clear error. Requires runtime detection. |
| **Feature parity validation** | Ensure both runtimes support required features | LOW | Validate during config load: "Agent X requires MCP servers, only available in SDK runtime" |

#### Docker Container Execution

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Resource limits (CPU/memory)** | Prevent runaway agents from consuming all resources | LOW | Docker `--memory` and `--cpus` flags. Best practice: set memory limit, avoid CPU limits (causes throttling). |
| **Network isolation modes** | Control agent network access (bridge/host/none) | LOW | Docker network drivers: bridge (default, isolated), host (no isolation), none (completely isolated) |
| **Volume mounting** | Agent needs access to workspace files | LOW | Mount workspace read-write, other paths read-only. Pattern: `--mount type=bind,src=./workspace,dst=/workspace` |
| **Automatic cleanup** | Remove stopped containers to prevent disk bloat | LOW | Use `--rm` flag or `docker container prune`. Critical for ephemeral agent workloads. |
| **Container logs capture** | Stream container output to job logs | MEDIUM | Capture stdout/stderr from container, append to job output file in real-time |
| **Process isolation** | Agent runs in isolated process namespace | LOW | Built-in Docker feature via Linux namespaces. Each container gets isolated PID namespace. |

#### Security & Isolation

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **User namespace remapping** | Container root ≠ host root | MEDIUM | Docker Enhanced Container Isolation (ECI) maps container root to unprivileged user. Critical for AI agents that generate code at runtime. |
| **Read-only root filesystem** | Prevent agent from modifying container internals | LOW | `--read-only` flag with writable tmpfs for /tmp. Workspace mounted separately as writable. |
| **Network restrictions** | Whitelist/blacklist domains | HIGH | Docker Sandboxes (2026) pattern: allow/deny lists for coding agent network access. Requires custom networking setup. |
| **MicroVM isolation (optional)** | Additional hard security boundary | HIGH | Docker Sandboxes use dedicated microVMs. Overkill for MVP, consider post-launch. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Runtime auto-selection based on features** | Automatically choose SDK when MCP needed, CLI when Max plan features required | MEDIUM | Inspect agent config → if `mcpServers` present, require SDK runtime. If `maxPlanFeatures` enabled, require CLI runtime. |
| **Runtime-specific pricing visibility** | Show cost implications of runtime choice | LOW | Display: "SDK runtime: Standard pricing" vs "CLI runtime: Requires Max plan subscription" |
| **Hybrid runtime fleet** | Some agents use SDK, others use CLI in same fleet | LOW | Natural consequence of runtime abstraction. Each agent independently configured. |
| **Container reuse for session persistence** | Don't destroy container between jobs if session mode is `persistent` | HIGH | Requires container lifecycle management, state tracking, idle timeout. Big DX win for persistent agents. |
| **Resource limit recommendations** | Suggest CPU/memory based on agent workload type | MEDIUM | Heuristics: coding agents need more memory (2GB+), monitoring agents lightweight (512MB). Profile and suggest. |
| **Workspace isolation modes** | Per-agent workspace or shared workspace with path restrictions | MEDIUM | Mount different workspace paths per agent vs shared workspace with ACLs. Enables multi-agent collaboration. |
| **Pre-built agent images** | Ship Docker images with common tools pre-installed | MEDIUM | Official `herdctl/agent:latest` image with Node, Python, common CLIs. Faster startup, consistent environment. |
| **Container escape detection** | Monitor for container breakout attempts | HIGH | AI agents generate code at runtime = higher escape risk (NVIDIA CVE-2024-12366). Implement runtime monitoring. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Full Kubernetes integration** | "Production-ready orchestration!" | Massive complexity for single-process model. herdctl runs in one process, K8s designed for distributed systems. | Offer Helm chart for deploying herdctl itself in K8s, but agents run as child processes/containers, not K8s pods. |
| **Automatic runtime switching mid-job** | "Use SDK first, fall back to CLI if SDK fails" | Nondeterministic execution, hard to debug, violates principle of least surprise | Fail fast with clear error. User explicitly configures runtime per agent. |
| **Container orchestrator abstraction** | "Support Docker, Podman, containerd" | Premature generalization. Docker has 89% market share (CNCF 2026). | Focus on Docker, document Podman compatibility later if demand exists. |
| **Unlimited container resources** | "Let agent use what it needs" | One runaway agent kills entire fleet. No graceful degradation. | Always set memory limits. Soft CPU requests, hard memory limits. |
| **Privileged containers by default** | "Need full system access" | Security nightmare. AI-generated code in privileged container = RCE waiting to happen. | Default to unprivileged. Provide `privileged: true` escape hatch with big warning. Document why it's dangerous. |
| **Shared network namespace across agents** | "Enable inter-agent communication" | Breaks isolation. Compromised agent can attack others. | Use Docker networks with explicit connectivity. Default to isolated networks. |

## Feature Dependencies

```
Runtime Abstraction
    ├──requires──> Unified interface (SDKQueryFunction abstraction)
    │                  └──requires──> SDK adapter (already exists)
    │                  └──requires──> CLI adapter (new)
    │
    ├──requires──> Runtime detection
    │                  └──requires──> SDK availability check
    │                  └──requires──> CLI availability check
    │
    └──requires──> Configuration schema extension
                       └──requires──> Runtime type field in agent config

Docker Container Execution
    ├──requires──> Container lifecycle management
    │                  └──requires──> Image pull/build
    │                  └──requires──> Container create
    │                  └──requires──> Container start/stop/remove
    │
    ├──requires──> Volume mounting
    │                  └──requires──> Workspace path resolution
    │                  └──requires──> Mount options (read-only, read-write)
    │
    ├──requires──> Resource limits
    │                  └──requires──> CPU/memory config schema
    │                  └──requires──> Docker run flags
    │
    └──enhances──> Job executor
                       └──requires──> Output streaming from container
                       └──requires──> Exit code handling

Security Features
    ├──requires──> User namespace remapping
    │                  └──requires──> Docker daemon configuration
    │
    ├──requires──> Network isolation
    │                  └──requires──> Docker network creation
    │                  └──requires──> Network policy config
    │
    └──conflicts──> Privileged mode (anti-feature)
```

### Dependency Notes

- **Runtime abstraction requires unified interface first:** Can't swap backends until common interface exists. Current `SDKQueryFunction` works for SDK, need `CLIQueryFunction` equivalent.
- **Docker execution enhances job executor:** Existing `JobExecutor` class streams SDK messages. Container execution wraps this - streams container logs instead of SDK messages.
- **Resource limits are independent features:** Can implement CPU limits without memory limits, but best practice: always set memory, optionally set CPU requests (not limits).
- **Security features have external dependencies:** User namespace remapping requires Docker daemon config changes, not just herdctl code.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- [x] **Unified runtime interface** — Define `RuntimeBackend` abstraction that both SDK and CLI implement
- [x] **SDK runtime adapter** — Wrap existing SDK integration behind `RuntimeBackend` interface (mostly refactoring existing code)
- [x] **CLI runtime adapter** — New implementation calling `claude-code` CLI, parsing output
- [x] **Configuration-driven runtime selection** — Add `runtime: { type: "sdk" | "cli" }` to agent config
- [x] **Basic Docker execution** — Run agent in container with workspace mount, resource limits
- [x] **Container cleanup** — Auto-remove stopped containers with `--rm` or prune command
- [x] **Network isolation** — Default to bridge network (isolated), config option for host/none
- [x] **Resource limits** — Memory limit required, CPU request optional

**Rationale for MVP scope:**
- Runtime abstraction core value: transparent SDK ↔ CLI switching based on pricing needs
- Docker isolation core value: prevent runaway agents, security boundary
- Everything else (container reuse, pre-built images, escape detection) can wait for validation

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] **Automatic runtime selection** — Inspect agent config, choose SDK if MCP present, CLI if Max features needed (trigger: users manually setting runtime)
- [ ] **Runtime-specific pricing display** — Show cost implications in CLI output (trigger: user confusion about pricing)
- [ ] **Container reuse for persistent sessions** — Keep container alive between jobs if `session.mode: persistent` (trigger: performance complaints about container startup time)
- [ ] **Pre-built agent images** — Official `herdctl/agent` Docker image with common tools (trigger: slow container builds)
- [ ] **Resource limit recommendations** — Suggest memory/CPU based on agent type (trigger: users asking "what should I set?")

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **MicroVM isolation** — Docker Sandboxes-style hard security boundary (defer: MVP doesn't need military-grade isolation)
- [ ] **Container escape detection** — Runtime monitoring for breakout attempts (defer: complex, low probability for MVP users)
- [ ] **Multi-orchestrator support** — Podman, containerd compatibility (defer: Docker is 89% of market, wait for demand)
- [ ] **Network allow/deny lists** — Whitelist/blacklist domains for agent network access (defer: complex networking, niche use case)
- [ ] **Custom agent images per agent** — Each agent uses different base image (defer: MVP uses single image, wait for customization requests)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Unified runtime interface | HIGH | LOW | P1 |
| SDK runtime adapter | HIGH | LOW | P1 |
| CLI runtime adapter | HIGH | MEDIUM | P1 |
| Configuration-driven runtime | HIGH | LOW | P1 |
| Basic Docker execution | HIGH | MEDIUM | P1 |
| Container cleanup | HIGH | LOW | P1 |
| Network isolation | MEDIUM | LOW | P1 |
| Resource limits (memory) | HIGH | LOW | P1 |
| Resource limits (CPU) | MEDIUM | LOW | P1 |
| Automatic runtime selection | MEDIUM | MEDIUM | P2 |
| Pricing visibility | MEDIUM | LOW | P2 |
| Container reuse | MEDIUM | HIGH | P2 |
| Pre-built images | MEDIUM | MEDIUM | P2 |
| Resource recommendations | LOW | MEDIUM | P2 |
| User namespace remapping | MEDIUM | MEDIUM | P2 |
| Read-only root filesystem | MEDIUM | LOW | P2 |
| MicroVM isolation | LOW | HIGH | P3 |
| Escape detection | LOW | HIGH | P3 |
| Multi-orchestrator support | LOW | HIGH | P3 |
| Network allow/deny lists | LOW | HIGH | P3 |
| Custom images per agent | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch (runtime abstraction + basic Docker)
- P2: Should have, add when possible (optimization, DX improvements)
- P3: Nice to have, future consideration (advanced security, multi-platform)

## Competitor Feature Analysis

| Feature | Docker Sandboxes (2026) | Generic Container Orchestrators | Our Approach |
|---------|-------------------------|--------------------------------|--------------|
| **Runtime abstraction** | N/A (focused on Docker only) | N/A (not AI-specific) | SDK ↔ CLI switching for pricing flexibility |
| **MicroVM isolation** | Yes (dedicated microVMs per agent) | No (process isolation only) | Defer to v2+ (overkill for MVP) |
| **Network isolation** | Yes (allow/deny lists) | Yes (network policies) | Start with bridge/host/none modes, add lists in v1.x |
| **Resource limits** | Yes (CPU/memory limits) | Yes (requests/limits) | Match industry standard (memory required, CPU optional) |
| **Container reuse** | No (ephemeral by design) | Yes (long-lived containers) | Add for persistent sessions (differentiator) |
| **Pre-built images** | No (user provides) | Yes (official images common) | v1.x feature (herdctl/agent image) |
| **Escape detection** | Yes (runtime monitoring) | Varies (advanced feature) | Defer to v2+ (complex, low MVP value) |
| **Multi-orchestrator** | Docker-only | Varies (K8s, ECS, etc.) | Docker-only MVP, document Podman compatibility later |

## Sources

### Runtime Abstraction
- [AnyIO Python Backend Abstraction 2026](https://johal.in/anyio-python-abstract-asyncio-trio-backend-abstraction-2026/)
- [Vextra: Unified Middleware Abstraction](https://arxiv.org/html/2601.06727)
- [Platform Engineering Abstraction Layers](https://platformengineering.org/blog/abstraction-layers)
- [ExecuTorch Platform Abstraction Layer](https://docs.pytorch.org/executorch/0.4/runtime-platform-abstraction-layer.html)

### Docker Container Orchestration
- [18 Best Container Orchestration Tools 2026](https://devopscube.com/docker-container-clustering-tools/)
- [Top 9 Container Orchestration Platforms 2026](https://www.portainer.io/blog/container-orchestration-platforms)
- [16 Container Orchestration Tools 2026](https://spacelift.io/blog/container-orchestration-tools)
- [Google Cloud: What is Container Orchestration](https://cloud.google.com/discover/what-is-container-orchestration)

### Security & Isolation
- [Docker Enhanced Container Isolation](https://docs.docker.com/security/for-admins/hardened-desktop/enhanced-container-isolation/)
- [Docker Sandboxes for AI Agent Safety 2026](https://www.docker.com/blog/docker-sandboxes-a-new-approach-for-coding-agent-safety/)
- [AI Agent Container Isolation Patterns](https://piotrnowicki.com/posts/2026-01-11/keeping-ai-agents-like-opencode-as-separate-environment-in-docker/)
- [Securing AI Agents with Docker MCP](https://cloudnativenow.com/contributed-content/securing-ai-agents-with-docker-mcp-and-cagent-building-trust-in-cloud-native-workflows/)
- [17 Container Security Vulnerabilities 2026](https://www.practical-devsecops.com/container-security-vulnerabilities/)
- [10 Container Security Best Practices 2026](https://www.sentinelone.com/cybersecurity-101/cloud-security/container-security-best-practices/)

### Resource Limits
- [Docker Resource Constraints Documentation](https://docs.docker.com/engine/containers/resource_constraints/)
- [Kubernetes Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Google Cloud: Kubernetes Requests vs Limits](https://cloud.google.com/blog/products/containers-kubernetes/kubernetes-best-practices-resource-requests-and-limits)
- [Azure: AKS Resource Management Best Practices](https://learn.microsoft.com/en-us/azure/aks/developer-best-practices-resource-management)

### Network Isolation
- [Docker Bridge Network Driver](https://docs.docker.com/engine/network/drivers/bridge/)
- [Docker None Network Driver](https://docs.docker.com/engine/network/drivers/none/)
- [Docker Networking Guide 2026](https://cyberpanel.net/blog/docker-bridge-network)
- [Docker Networking Explained](https://aws.plainenglish.io/docker-networking-explained-bridge-host-none-custom-networks-hands-on-for-devops-engineers-138ac65b517a)

### Container Cleanup
- [Docker Prune Documentation](https://docs.docker.com/engine/manage-resources/pruning/)
- [Docker Cleanup Guide 2026](https://oneuptime.com/blog/post/2026-01-06-docker-disk-usage-cleanup/view)
- [Kubernetes Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/)
- [Docker System Prune Documentation](https://docs.docker.com/reference/cli/docker/system/prune/)

### Volume Mounting
- [VS Code: Change Default Source Mount](https://code.visualstudio.com/remote/advancedcontainers/change-default-source-mount)
- [Docker Container Isolation](https://sigridjin.medium.com/docker-and-container-isolation-85e235aa5854)
- [Azure Batch Container Isolation](https://learn.microsoft.com/en-us/azure/batch/batch-container-isolation-task)

---
*Feature research for: Runtime abstraction and Docker containerization for autonomous agent execution*
*Researched: 2026-01-31*
