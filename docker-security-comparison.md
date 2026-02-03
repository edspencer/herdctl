# Docker Security Comparison: Claude Code Native vs Docker Isolation

[Ed: Claude Code generated this in response to me asking it to compare Docker to Claude Code sandboxing.]

This document compares Claude Code's native sandboxing security with the additional protections provided by running agents in Docker containers via herdctl.

## Claude Code's Native Security

Claude Code uses [**bubblewrap** on Linux](https://github.com/containers/bubblewrap) and [**Seatbelt** on macOS](https://theapplewiki.com/wiki/Dev:Seatbelt) for OS-level sandboxing, plus a domain-filtering network proxy.

### Known Vulnerabilities in 2025

The network proxy has been bypassed multiple times:

- **[CVE-2025-55284](https://embracethered.com/blog/posts/2025/claude-code-exfiltration-via-dns-requests/)** - DNS exfiltration: Commands like `ping`, `dig`, `nslookup` were allowlisted without approval. Attackers could embed API keys into DNS subdomain queries to exfiltrate data. Fixed in v1.0.4.

- **[CVE-2025-66479](https://oddguan.com/blog/anthropic-sandbox-cve-2025-66479/)** - Empty allowlist bypass: Setting `allowedDomains: []` (expecting complete isolation) actually disabled ALL network restrictions due to a logic bug (`allowedDomains.length > 0` evaluated to false). Quietly patched in v2.0.55.

- **[CVE-2025-52882](https://securitylabs.datadoghq.com/articles/claude-mcp-cve-2025-52882/)** - WebSocket auth bypass in VS Code extension allowing code execution.

The [official docs](https://code.claude.com/docs/en/sandboxing) also warn about domain fronting bypasses and risks from allowing broad domains like `github.com`.

---

## Bullet-by-Bullet Comparison

### 1. File System Isolation

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| Uses bubblewrap/Seatbelt to restrict access to working directory. Can read most of filesystem, can only write to cwd. Still the same filesystem - just access controls. | Completely separate root filesystem. Only explicit volume mounts are visible. Your `~/.ssh`, `~/.aws`, browser profiles literally don't exist inside the container. |

**Docker adds:** True isolation vs. access control. The agent can't accidentally read something you forgot to deny - it simply doesn't exist.

### 2. Network Control

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| Domain-allowlist proxy. Has had multiple CVEs (DNS exfiltration, empty allowlist bypass, domain fronting). Proxy runs in userspace - same privilege level as the sandboxed code. | Kernel-level network namespace. Completely separate network stack. Can use `network: none` for total isolation, or `bridge` with iptables/firewall rules. |

**Docker adds:** Kernel-enforced isolation vs. userspace proxy. Much harder to bypass - the network simply doesn't exist until you create it. No proxy to fool.

### 3. Environment Variable Control

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| **None.** The sandbox doesn't filter environment variables. Your full shell environment (API keys, tokens, paths) is accessible. | Fresh environment. Only variables you explicitly pass via `env:` are available. No access to host's `$GITHUB_TOKEN`, `$AWS_SECRET_ACCESS_KEY`, etc. |

**Docker adds:** This is a major gap in Claude Code's sandbox. Docker gives you complete control.

### 4. Non-Root Execution

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| Runs as invoking user. No special isolation - same UID as your shell. | Configurable UID:GID. User namespace isolation available. Can run as completely different user than host. |

**Docker adds:** Similar end result (non-root), but Docker's user namespaces provide an additional layer - UID 0 in container can map to unprivileged UID on host.

### 5. Resource Limits

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| **None mentioned.** No memory caps, CPU limits, or process limits in the sandbox. A runaway `npm install` or fork bomb could exhaust host resources. | Full cgroup controls: memory limits, CPU shares/quota, pids_limit to prevent fork bombs. Container gets killed if it exceeds limits. |

**Docker adds:** This is entirely new protection. Claude Code sandbox has no resource controls.

### 6. Ephemeral Execution

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| Sessions persist. Files created remain. State accumulates across runs. | `ephemeral: true` gives fresh container per job. No persistent malware, no accumulated state, no leftover artifacts. |

**Docker adds:** Clean-slate execution. If something bad happens, it's gone next run.

### 7. Process Isolation

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| Child processes inherit sandbox restrictions. But `ps aux` would still show host processes (on macOS/Seatbelt especially). | PID namespace. Container only sees its own processes. `ps aux` shows only container processes. Can't signal or inspect host processes. |

**Docker adds:** True PID isolation. The host process tree is invisible.

### 8. Capability Dropping

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| bubblewrap uses `PR_SET_NO_NEW_PRIVS` and drops some caps. Seatbelt works differently (syscall filtering). | Docker drops all capabilities except a small safe set by default. Well-documented, battle-tested defaults. |

**Docker adds:** Similar level of protection, but Docker's is more consistent across platforms and better documented.

### 9. Seccomp Filtering

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| bubblewrap can use seccomp. Not clear if Claude Code enables it. Seatbelt has its own syscall filtering. | Default seccomp profile blocks ~44 dangerous syscalls. Well-audited, production-hardened. |

**Docker adds:** Comparable protection, but Docker's profile is widely deployed and battle-tested.

### 10. Namespace Isolation

| Claude Code Native | Docker Addition |
|-------------------|-----------------|
| bubblewrap uses mount/PID/net namespaces on Linux. Seatbelt on macOS is completely different technology (not namespaces). | Full namespace isolation: PID, network, mount, UTS, user. Consistent across platforms. |

**Docker adds:** Consistency. On Linux it's similar, but Docker provides the same isolation model everywhere.

---

## Summary Table

| Security Property | Claude Code | Docker | Docker Adds |
|-------------------|-------------|--------|-------------|
| **File system isolation** | ✅ Access controls (same fs) | ✅ Separate filesystem | True isolation vs. ACLs |
| **Network control** | ⚠️ Proxy (multiple CVEs) | ✅ Kernel namespaces | Kernel-level vs. userspace |
| **Environment variables** | ❌ No protection | ✅ Fresh environment | **Major addition** |
| **Resource limits** | ❌ None | ✅ cgroups (mem/cpu/pids) | **Major addition** |
| **Ephemeral execution** | ❌ Persistent | ✅ Fresh per job | Clean-slate runs |
| **Process isolation** | ⚠️ Partial | ✅ PID namespace | Full isolation |
| **Capability dropping** | ✅ Some | ✅ Comprehensive | Similar |
| **Seccomp filtering** | ⚠️ Unclear | ✅ Default profile | Consistent |

The biggest wins from Docker are: environment variable isolation, resource limits, and a battle-hardened network isolation that doesn't rely on a userspace proxy with a history of CVEs.

---

## Sources

- [Claude Code Sandboxing Docs](https://code.claude.com/docs/en/sandboxing)
- [Anthropic Engineering: Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [CVE-2025-55284: DNS Exfiltration](https://embracethered.com/blog/posts/2025/claude-code-exfiltration-via-dns-requests/)
- [CVE-2025-66479: Sandbox Misconfiguration](https://oddguan.com/blog/anthropic-sandbox-cve-2025-66479/)
- [CVE-2025-52882: WebSocket Bypass](https://securitylabs.datadoghq.com/articles/claude-mcp-cve-2025-52882/)
- [bubblewrap GitHub](https://github.com/containers/bubblewrap)
- [macOS Seatbelt](https://theapplewiki.com/wiki/Dev:Seatbelt)
