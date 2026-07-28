/**
 * Incremental index over the job metadata directory
 *
 * `listJobs` needs three cheap facts about every `job-*.yaml` in order to filter,
 * sort and paginate — `agent`, `status` and `started_at` — but obtaining them the
 * naive way means YAML-parsing the whole record, and job records are dominated by
 * two large free-text fields (`prompt` and `summary` are ~99% of the bytes on a
 * real instance). This module keeps those three facts — `started_at` reduced to
 * epoch ms — in an mtime-keyed cache, so repeated listings only re-parse files
 * that are new or have changed, mirroring the approach `AttributionIndexBuilder`
 * already uses for session attribution.
 *
 * Deliberately **not** cached: the full job record. Holding parsed records for a
 * 2,000-job directory measured at ~142 MB of heap, versus ~2 MB for the index
 * alone, so full records are always re-read for the (usually small) set of jobs a
 * caller actually asked for. That also means every record `listJobs` hands out is
 * freshly parsed, exactly as before — callers never share mutable objects with the
 * cache.
 */

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type JobMetadata, JobMetadataSchema, type JobStatus } from "./schemas/job-metadata.js";
import { safeReadYaml } from "./utils/reads.js";

// =============================================================================
// Tuning
// =============================================================================

/**
 * Maximum number of job files stat-ed / read concurrently.
 *
 * Sequential I/O is what makes the cold pass slow; unbounded concurrency risks
 * exhausting file descriptors on very large directories. 32 captures nearly all
 * of the available speed-up on the measured instance.
 */
const IO_CONCURRENCY = 32;

/**
 * How many distinct job directories to keep indexes for. A process normally
 * touches one, but tests and multi-fleet hosts touch several; this bounds the
 * cache without needing explicit invalidation.
 */
const MAX_CACHED_DIRS = 16;

// =============================================================================
// Types
// =============================================================================

/**
 * The subset of a job record `listJobs` can filter and sort on without reading
 * the record's large text fields.
 */
export interface JobIndexRecord {
  agent: string;
  status: JobStatus;
  /** `started_at` pre-parsed to epoch ms, for sorting and date filters */
  startedAtMs: number;
}

/** One job file's entry in the index. */
export interface JobIndexEntry {
  /** File name within the jobs dir (e.g. `job-2026-01-15-abc123.yaml`) */
  file: string;
  /** Indexed fields, or `null` if the file could not be read or validated */
  record: JobIndexRecord | null;
  /** Warning to emit for an unreadable/corrupt file (set iff `record` is null) */
  warning?: string;
}

/** Result of refreshing the index for one directory. */
export interface JobIndexRefresh {
  /** Entries in `readdir` order, so callers inherit its (stable) tie-breaking */
  entries: JobIndexEntry[];
  /**
   * Full records parsed during *this* refresh and worth keeping, keyed by file
   * name. Lets a caller reuse the parse it just paid for instead of reading the
   * file a second time.
   */
  fresh: Map<string, JobMetadata>;
}

/** Options for {@link refreshJobIndex}. */
export interface RefreshJobIndexOptions {
  /**
   * Predicate deciding whether a freshly parsed record is worth holding onto in
   * {@link JobIndexRefresh.fresh}. Records that can't satisfy the caller's filter
   * are dropped immediately so a cold pass doesn't retain the whole directory.
   */
  retain?: (record: JobIndexRecord) => boolean;
}

interface CachedFile {
  /** File mtime (epoch ms) when last parsed — the cache-invalidation key */
  mtimeMs: number;
  /** File size when last parsed, guarding against same-mtime rewrites */
  size: number;
  record: JobIndexRecord | null;
  warning?: string;
}

// =============================================================================
// Cache
// =============================================================================

/** Per-directory file caches, keyed by resolved jobs dir path. */
const dirCaches = new Map<string, Map<string, CachedFile>>();

function cacheForDir(jobsDir: string): Map<string, CachedFile> {
  const key = resolve(jobsDir);
  const existing = dirCaches.get(key);

  // Re-insert to mark most-recently-used.
  if (existing) {
    dirCaches.delete(key);
    dirCaches.set(key, existing);
    return existing;
  }

  const created = new Map<string, CachedFile>();
  dirCaches.set(key, created);

  while (dirCaches.size > MAX_CACHED_DIRS) {
    const oldest = dirCaches.keys().next().value;
    if (oldest === undefined) break;
    dirCaches.delete(oldest);
  }

  return created;
}

/**
 * Drop cached job index state.
 *
 * The index is validated against file mtime and size on every use, so clearing it
 * is never required for correctness — it exists for tests and for callers that
 * want to release the memory.
 *
 * @param jobsDir - Directory to forget; omit to forget every directory
 */
export function clearJobIndexCache(jobsDir?: string): void {
  if (jobsDir === undefined) {
    dirCaches.clear();
    return;
  }
  dirCaches.delete(resolve(jobsDir));
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Return a standalone copy of a string.
 *
 * The `yaml` parser produces scalars by slicing the whole document text, and V8
 * represents those as SlicedStrings that keep the entire ~24 KB source alive.
 * Caching them verbatim measured at 99 MB for 1,996 records versus 2.1 MB for
 * detached copies, so copy before storing.
 */
function detachString(value: string): string {
  return JSON.parse(JSON.stringify(value)) as string;
}

/** Map over items with a bounded number of concurrent workers, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);

  return results;
}

/** Is this directory entry a job metadata file? */
function isJobFile(name: string): boolean {
  return name.startsWith("job-") && name.endsWith(".yaml");
}

/** Project a validated job record down to its indexed fields. */
function toIndexRecord(job: JobMetadata): JobIndexRecord {
  return {
    agent: detachString(job.agent),
    status: job.status,
    startedAtMs: new Date(job.started_at).getTime(),
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Refresh (and return) the index for a jobs directory.
 *
 * Stats every job file — cheap — and re-reads only files that are new or whose
 * mtime/size changed. Entries for files that have disappeared are dropped.
 *
 * @param jobsDir - Path to the jobs directory
 * @param options - Refresh options
 * @returns Index entries in `readdir` order plus any records parsed on this pass
 * @throws The underlying `readdir` error (including ENOENT) if the directory
 *   cannot be listed — callers decide how to treat a missing directory
 */
export async function refreshJobIndex(
  jobsDir: string,
  options: RefreshJobIndexOptions = {},
): Promise<JobIndexRefresh> {
  const { retain } = options;

  let jobFiles: string[];
  try {
    jobFiles = (await readdir(jobsDir)).filter(isJobFile);
  } catch (error) {
    // The directory is gone (or unreadable) — don't keep an index for it.
    clearJobIndexCache(jobsDir);
    throw error;
  }

  const cache = cacheForDir(jobsDir);
  const present = new Set(jobFiles);
  for (const cachedFile of cache.keys()) {
    if (!present.has(cachedFile)) {
      cache.delete(cachedFile);
    }
  }

  const fresh = new Map<string, JobMetadata>();

  const entries = await mapWithConcurrency(
    jobFiles,
    IO_CONCURRENCY,
    async (file): Promise<JobIndexEntry> => {
      const filePath = join(jobsDir, file);

      let mtimeMs: number;
      let size: number;
      try {
        const stats = await stat(filePath);
        mtimeMs = stats.mtimeMs;
        size = stats.size;
      } catch (error) {
        // Vanished (or became unreadable) between readdir and stat. Reported as
        // an unreadable file, which is how the pre-index code surfaced it.
        cache.delete(file);
        return {
          file,
          record: null,
          warning: `Failed to read job file ${filePath}: ${(error as Error).message}`,
        };
      }

      const cached = cache.get(file);
      if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
        return { file, record: cached.record, warning: cached.warning };
      }

      const result = await safeReadYaml<unknown>(filePath);
      if (!result.success) {
        const warning = `Failed to read job file ${filePath}: ${result.error.message}`;
        cache.set(file, { mtimeMs, size, record: null, warning });
        return { file, record: null, warning };
      }

      const parsed = JobMetadataSchema.safeParse(result.data);
      if (!parsed.success) {
        const warning = `Corrupted job file ${filePath}: ${parsed.error.message}`;
        cache.set(file, { mtimeMs, size, record: null, warning });
        return { file, record: null, warning };
      }

      const record = toIndexRecord(parsed.data);
      cache.set(file, { mtimeMs, size, record });

      // Hold the full record only while it might still be wanted, so a cold pass
      // over a filtered listing doesn't retain the entire directory.
      if (!retain || retain(record)) {
        fresh.set(file, parsed.data);
      }

      return { file, record };
    },
  );

  return { entries, fresh };
}
