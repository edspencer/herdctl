/**
 * Session attribution module
 *
 * Determines the origin of a Claude Code session (web, discord, slack, schedule, or native CLI)
 * by cross-referencing HerdCTL's job metadata and platform session YAML files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { listAdoptions } from "./adopted-sessions.js";
import { listJobs } from "./job-metadata.js";
import { JobMetadataSchema, type TriggerType } from "./schemas/job-metadata.js";
import { safeReadYaml } from "./utils/reads.js";

// =============================================================================
// Types
// =============================================================================

export type SessionOrigin = "web" | "discord" | "slack" | "schedule" | "native" | "adopted";

export interface SessionAttribution {
  origin: SessionOrigin;
  agentName: string | undefined;
  triggerType: string | undefined;
}

export interface AttributionIndex {
  /** Attribute a single session ID */
  getAttribute(sessionId: string): SessionAttribution;
  /** Batch attribute multiple session IDs */
  getAttributes(sessionIds: string[]): Map<string, SessionAttribution>;
  /** Number of entries in the index (for diagnostics) */
  readonly size: number;
}

// =============================================================================
// Internal Types
// =============================================================================

interface JobIndexEntry {
  agent: string;
  triggerType: string;
}

interface PlatformIndexEntry {
  platform: "discord" | "slack" | "web";
  agentName: string;
}

interface AdoptedIndexEntry {
  agentName: string;
}

// =============================================================================
// Schemas
// =============================================================================

const PlatformSessionSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  agentName: z.string(),
  channels: z.record(
    z.string(),
    z.object({
      sessionId: z.string(),
      lastMessageAt: z.string(),
    }),
  ),
});

// =============================================================================
// Logger
// =============================================================================

const logger = createLogger("SessionAttribution");

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a trigger type to a session origin
 */
function triggerTypeToOrigin(triggerType: TriggerType): SessionOrigin {
  switch (triggerType) {
    case "web":
      return "web";
    case "discord":
      return "discord";
    case "slack":
      return "slack";
    case "schedule":
      return "schedule";
    // manual, webhook, chat, fork — all treated as native CLI usage
    default:
      return "native";
  }
}

/**
 * Build the job index from job metadata files
 */
async function buildJobIndex(jobsDir: string): Promise<Map<string, JobIndexEntry>> {
  const index = new Map<string, JobIndexEntry>();

  const result = await listJobs(jobsDir, {}, { logger });

  for (const job of result.jobs) {
    if (job.session_id) {
      index.set(job.session_id, {
        agent: job.agent,
        triggerType: job.trigger_type,
      });
    }
  }

  return index;
}

/**
 * Build the platform index from platform session YAML files
 */
async function buildPlatformIndex(stateDir: string): Promise<Map<string, PlatformIndexEntry>> {
  const index = new Map<string, PlatformIndexEntry>();
  const platforms = ["discord", "slack", "web"] as const;

  for (const platform of platforms) {
    const sessionDir = path.join(stateDir, `${platform}-sessions`);

    let fileNames: string[];
    try {
      fileNames = await fs.readdir(sessionDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug(`Session directory does not exist: ${sessionDir}`);
        continue;
      }
      throw error;
    }

    const yamlFiles = fileNames.filter((name) => name.endsWith(".yaml"));

    for (const fileName of yamlFiles) {
      const filePath = path.join(sessionDir, fileName);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = yaml.parse(content);
        const validated = PlatformSessionSchema.safeParse(parsed);

        if (!validated.success) {
          logger.warn(`Malformed platform session file: ${filePath}: ${validated.error.message}`);
          continue;
        }

        const session = validated.data;

        for (const channel of Object.values(session.channels)) {
          index.set(channel.sessionId, {
            platform,
            agentName: session.agentName,
          });
        }
      } catch (error) {
        if (error instanceof yaml.YAMLParseError) {
          logger.warn(`Failed to parse YAML file: ${filePath}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }
  }

  return index;
}

/**
 * Build the adoption index from the adopted-sessions store
 *
 * Adoption records are few and mutable (a session can be adopted, re-adopted by
 * another agent, or released), so — unlike job records — there is no incremental
 * mtime cache here: every build re-reads the store in full. A missing store
 * directory means "no adoptions", the same way a missing platform directory does.
 */
async function buildAdoptedIndex(stateDir: string): Promise<Map<string, AdoptedIndexEntry>> {
  const index = new Map<string, AdoptedIndexEntry>();

  for (const record of await listAdoptions(stateDir)) {
    index.set(record.sessionId, { agentName: record.agentName });
  }

  return index;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build an attribution index from job metadata and platform YAML files
 *
 * @param stateDir - Path to the .herdctl state directory
 * @returns An AttributionIndex for looking up session origins
 *
 * @example
 * ```typescript
 * const index = await buildAttributionIndex('/path/to/.herdctl');
 * const attribution = index.getAttribute('session-123');
 * console.log(attribution.origin); // 'discord'
 * ```
 */
export async function buildAttributionIndex(stateDir: string): Promise<AttributionIndex> {
  const jobsDir = path.join(stateDir, "jobs");

  const [jobIndex, platformIndex, adoptedIndex] = await Promise.all([
    buildJobIndex(jobsDir),
    buildPlatformIndex(stateDir),
    buildAdoptedIndex(stateDir),
  ]);

  return createAttributionIndex(jobIndex, platformIndex, adoptedIndex);
}

/**
 * Assemble the {@link AttributionIndex} lookup object from a job index, a
 * platform index and an adoption index. Shared by the full
 * {@link buildAttributionIndex} and the incremental {@link AttributionIndexBuilder}.
 */
function createAttributionIndex(
  jobIndex: Map<string, JobIndexEntry>,
  platformIndex: Map<string, PlatformIndexEntry>,
  adoptedIndex: Map<string, AdoptedIndexEntry>,
): AttributionIndex {
  const getAttribute = (sessionId: string): SessionAttribution => {
    // Check job index first
    const jobEntry = jobIndex.get(sessionId);
    if (jobEntry) {
      return {
        origin: triggerTypeToOrigin(jobEntry.triggerType as TriggerType),
        agentName: jobEntry.agent,
        triggerType: jobEntry.triggerType,
      };
    }

    // Check platform index
    const platformEntry = platformIndex.get(sessionId);
    if (platformEntry) {
      return {
        origin: platformEntry.platform,
        agentName: platformEntry.agentName,
        triggerType: undefined,
      };
    }

    // Check the adoption store last, before falling back to native: a real run
    // record (job) or a live platform binding is stronger evidence of a session's
    // origin than an after-the-fact adoption claim, so adoption never overrides
    // them — it only rescues sessions that would otherwise be unattributed.
    const adoptedEntry = adoptedIndex.get(sessionId);
    if (adoptedEntry) {
      return {
        origin: "adopted",
        agentName: adoptedEntry.agentName,
        triggerType: undefined,
      };
    }

    // Default to native
    return {
      origin: "native",
      agentName: undefined,
      triggerType: undefined,
    };
  };

  const getAttributes = (sessionIds: string[]): Map<string, SessionAttribution> => {
    const result = new Map<string, SessionAttribution>();
    for (const sessionId of sessionIds) {
      result.set(sessionId, getAttribute(sessionId));
    }
    return result;
  };

  // Calculate unique session IDs across all three indexes
  const allSessionIds = new Set([
    ...jobIndex.keys(),
    ...platformIndex.keys(),
    ...adoptedIndex.keys(),
  ]);

  return {
    getAttribute,
    getAttributes,
    get size() {
      return allSessionIds.size;
    },
  };
}

// =============================================================================
// Ownership predicates
// =============================================================================
//
// One question — "who owns this session?" — was previously asked in two places
// with two different answers (herdctl#437). The listing gate asked whether
// `agentName` matched; the adoption gate asked whether `origin` was `"native"`.
// Those are NOT the same question, because `triggerTypeToOrigin` folds `manual`,
// `webhook`, `chat` and `fork` into `"native"`: a session with a real job record
// under a *sibling* agent is `{ origin: "native", agentName: "sweeper-x" }`, so
// it passed the adoption gate and then failed the listing gate. It was adopted,
// reported as imported, and never appeared.
//
// The functions below are the single source of that answer. Crucially the
// adoption gate is *defined in terms of* the listing gate — `canAgentAdopt` is
// literally "would `isOwnedByAgent` be true afterwards" — so the two can no
// longer drift apart: there is only one `isOwnedByAgent`, and everything else
// derives from it.

/**
 * Does `agentName` own this session — i.e. will it appear in that agent's
 * listing?
 *
 * This is THE listing gate. Every other predicate here is expressed through it.
 *
 * `agentName` is nullable to match the docker-directory call site, where the
 * scanned directory may carry no agent name. An `undefined` name therefore
 * matches exactly the unattributed sessions — the pre-existing behaviour of that
 * gate, preserved deliberately.
 */
export function isOwnedByAgent(
  attribution: SessionAttribution,
  agentName: string | undefined,
): boolean {
  return attribution.agentName === agentName;
}

/**
 * Is this session owned by nobody at all?
 *
 * The scan gate for adoption. Strictly stronger than `origin === "native"`,
 * which is only the *absence of a platform/schedule/web run* and says nothing
 * about whether an agent already has a claim.
 */
export function isUnattributed(attribution: SessionAttribution): boolean {
  return attribution.origin === "native" && attribution.agentName === undefined;
}

/**
 * The attribution a session would resolve to if `agentName` adopted it right
 * now.
 *
 * Mirrors the precedence order encoded in {@link createAttributionIndex}: an
 * adoption record is read *after* job records and platform bindings, so those
 * keep their claim and the new record is inert. A prior *adoption* is different
 * — `recordAdoption` overwrites it — so re-adoption really does take effect.
 *
 * Those two cases are distinguishable without knowing which index an attribution
 * came from: only the adoption store yields `origin: "adopted"`, and only the
 * unattributed fallback yields no `agentName`.
 */
export function attributionAfterAdoptionBy(
  attribution: SessionAttribution,
  agentName: string,
): SessionAttribution {
  const adoptionWouldWin = attribution.origin === "adopted" || attribution.agentName === undefined;

  return adoptionWouldWin ? { origin: "adopted", agentName, triggerType: undefined } : attribution;
}

/**
 * Would writing an adoption record for `agentName` actually make this session
 * that agent's — either by winning the precedence contest, or because the agent
 * already owns it?
 *
 * The adopt-time gate. Deliberately looser than {@link isUnattributed}: a
 * session the agent already owns is not worth *offering* in a picker (it is
 * already there), but re-claiming it is a harmless idempotent no-op rather than
 * something to refuse. The relationship `isUnattributed(a) ⇒ canAgentAdopt(a,
 * anyAgent)` is what guarantees the scan never proposes something the adopt path
 * would reject.
 */
export function canAgentAdopt(attribution: SessionAttribution, agentName: string): boolean {
  return isOwnedByAgent(attributionAfterAdoptionBy(attribution, agentName), agentName);
}

/**
 * Does `candidate` beat the currently-held claim on the same session id?
 *
 * Newest `started_at` wins; ties break on job id. Both are ISO-8601 / fixed-shape
 * strings, so lexicographic comparison is chronological and total — the point is
 * that the winner depends only on the records themselves, never on the order the
 * filesystem happened to hand them to us.
 */
function claimWins(
  candidate: { startedAt: string; jobId: string },
  held: { startedAt: string; jobId: string },
): boolean {
  if (candidate.startedAt !== held.startedAt) return candidate.startedAt > held.startedAt;
  return candidate.jobId > held.jobId;
}

/** One job file's contribution to the index, memoized by the builder. */
interface CachedJobFile {
  /** File mtime (epoch ms) when last parsed — the cache-invalidation key. */
  mtimeMs: number;
  /**
   * The session→attribution entry this job contributes, or `null` when the job
   * has no `session_id` yet (e.g. still running) or failed to parse. Cached
   * either way so we don't re-read an unchanged file.
   */
  entry: {
    sessionId: string;
    agent: string;
    triggerType: string;
    /** The record's own `started_at` — orders competing claims on one session. */
    startedAt: string;
    /** The job id — a stable tie-break when two claims share a timestamp. */
    jobId: string;
  } | null;
}

/**
 * Incremental builder for the attribution index.
 *
 * The full {@link buildAttributionIndex} reads and YAML-parses *every* job record
 * on each build. For a long-running fleet that accumulates thousands of jobs,
 * that's the dominant cost of listing sessions once the per-listing cache
 * expires. Job records are effectively immutable except for a small tail (a job
 * gains its `session_id` and a terminal status when it finishes), so this builder
 * keeps a per-file cache keyed on mtime and re-parses only files that are new or
 * whose mtime changed — turning each rebuild from O(jobs) reads into O(jobs)
 * cheap stats + O(changed) parses.
 *
 * Platform session files and adoption records are few and mutable, so they're
 * still read in full each build.
 *
 * A single builder instance must be reused across builds to get the benefit.
 */
export class AttributionIndexBuilder {
  private readonly jobFileCache = new Map<string, CachedJobFile>();

  /** Build (or incrementally refresh) the attribution index for a state dir. */
  async build(stateDir: string): Promise<AttributionIndex> {
    const jobsDir = path.join(stateDir, "jobs");
    const [jobIndex, platformIndex, adoptedIndex] = await Promise.all([
      this.buildJobIndexIncremental(jobsDir),
      buildPlatformIndex(stateDir),
      buildAdoptedIndex(stateDir),
    ]);
    return createAttributionIndex(jobIndex, platformIndex, adoptedIndex);
  }

  private async buildJobIndexIncremental(jobsDir: string): Promise<Map<string, JobIndexEntry>> {
    let files: string[];
    try {
      files = await fs.readdir(jobsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.jobFileCache.clear();
        return new Map();
      }
      throw error;
    }

    const jobFiles = files.filter((f) => f.startsWith("job-") && f.endsWith(".yaml"));
    const present = new Set(jobFiles);

    // Drop cache entries for job files that have been deleted/pruned.
    for (const cachedFile of this.jobFileCache.keys()) {
      if (!present.has(cachedFile)) {
        this.jobFileCache.delete(cachedFile);
      }
    }

    // Stat every file (cheap); re-parse only new or changed ones.
    await Promise.all(
      jobFiles.map(async (file) => {
        const filePath = path.join(jobsDir, file);

        let mtimeMs: number;
        try {
          mtimeMs = (await fs.stat(filePath)).mtimeMs;
        } catch {
          // Vanished between readdir and stat — forget it.
          this.jobFileCache.delete(file);
          return;
        }

        const cached = this.jobFileCache.get(file);
        if (cached && cached.mtimeMs === mtimeMs) {
          return; // unchanged — reuse the cached contribution
        }

        const result = await safeReadYaml<unknown>(filePath);
        if (!result.success) {
          logger.warn(`Failed to read job file ${filePath}: ${result.error.message}`);
          this.jobFileCache.set(file, { mtimeMs, entry: null });
          return;
        }

        const parsed = JobMetadataSchema.safeParse(result.data);
        if (!parsed.success) {
          logger.warn(`Corrupted job file ${filePath}: ${parsed.error.message}`);
          this.jobFileCache.set(file, { mtimeMs, entry: null });
          return;
        }

        const job = parsed.data;
        this.jobFileCache.set(file, {
          mtimeMs,
          entry: job.session_id
            ? {
                sessionId: job.session_id,
                agent: job.agent,
                triggerType: job.trigger_type,
                startedAt: job.started_at,
                jobId: job.id,
              }
            : null,
        });
      }),
    );

    // Assemble the session→attribution map from the cached per-file contributions.
    //
    // Two records CAN claim one session id: deliberately, when a session is
    // re-attributed (a promote/adopt writes a record naming the new owner), and
    // accidentally, when a co-located agent's spawn was handed the wrong session
    // id (issue #357 — which `--session-id` now prevents at the source).
    //
    // Resolving that by iteration order was the bug: this map used to be filled
    // in `Promise.all` completion order, so the winner was whichever file's
    // stat+parse happened to finish last — i.e. decided by file size and machine
    // load, with no owner semantics at all. Identical on-disk state could resolve
    // to a different agent on a different machine or under different load.
    //
    // Order explicitly instead: the LATEST claim wins, tie-broken by job id. That
    // keeps deliberate re-attribution working (a promote's record is newer, so it
    // still wins) while making the answer a pure function of what is on disk.
    const index = new Map<string, JobIndexEntry>();
    const winners = new Map<string, { startedAt: string; jobId: string }>();
    for (const { entry } of this.jobFileCache.values()) {
      if (!entry) continue;
      const held = winners.get(entry.sessionId);
      if (held && !claimWins(entry, held)) continue;
      winners.set(entry.sessionId, { startedAt: entry.startedAt, jobId: entry.jobId });
      index.set(entry.sessionId, { agent: entry.agent, triggerType: entry.triggerType });
    }
    return index;
  }
}
