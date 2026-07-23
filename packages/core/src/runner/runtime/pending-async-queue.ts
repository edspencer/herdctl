/**
 * Detect a stale, un-drained async-input backlog left in a `claude` CLI session.
 *
 * ## The failure this correlates with
 *
 * When a keeper backgrounds Task agents and the turn boundary kills them
 * (herdctl#374), the `claude` CLI enqueues `killed` `<task-notification>` messages
 * into the session's on-disk async-input queue (`type:"queue-operation"`,
 * `operation:"enqueue"`). If the process tears down before those enqueues are
 * dequeued, they persist in the transcript. Later — even days later, when the
 * session is no longer reaper-live — a human sends a message and `claude --resume`
 * reattaches. The CLI replays the stale backlog as its own turn AHEAD of the
 * caller's prompt turn; reaping on the backlog turn's `turn_end` tears the human
 * turn down mid-flight and the SDK emits `[Request interrupted by user]` — the
 * human message is lost (herdctl#406).
 *
 * Ground-truth signature (real transcript `dcd8e17e-…`): five `enqueue`
 * `<task-notification>` ops with `<status>killed</status>` that were never
 * dequeued before the process died. This helper detects exactly that residue.
 *
 * ## Telemetry only — NOT the fix, NOT a gate
 *
 * The resume seam (`openChatSession`, herdctl#406) arms its turn-end reap grace
 * **unconditionally** on any real resume that carries a prompt — it does NOT gate
 * on this detector. The replay is background-task-state-driven; this queue residue
 * is only a correlated side-effect, so detection is correlation-not-causation and
 * a future replay could leave no residue. This helper is retained purely to **log**
 * whether residue was present on a given resume so production logs can correlate
 * the failure signature; it must never gate reap behavior.
 *
 * ## Detection
 *
 * The CLI records every queue mutation to the transcript as a `queue-operation`
 * with `operation:"enqueue"` / `"dequeue"`. A clean turn boundary leaves the queue
 * empty (every enqueue matched by a dequeue). A running tally over the transcript
 * (+1 per enqueue, −1 per dequeue, clamped at 0) that ends **above zero** means
 * inputs were enqueued but never dequeued — a pending backlog that the CLI will
 * replay on the next resume. The exact count is not important; any positive
 * residue is the signal.
 */

import { readFile } from "node:fs/promises";

/**
 * Compute the net number of un-dequeued async-input `queue-operation` entries in a
 * CLI session transcript.
 *
 * @param sessionFilePath Absolute path to the `<sessionId>.jsonl` transcript.
 * @returns The pending-queue depth (0 if the file is missing, unreadable, or the
 *   queue is balanced). Never throws — a detection failure degrades to "no
 *   backlog" so the resume path is unchanged.
 */
export async function countPendingAsyncQueueEntries(sessionFilePath: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(sessionFilePath, "utf8");
  } catch {
    // Missing / unreadable transcript (e.g. a fresh session that never wrote one):
    // treat as no backlog. The serialize path is a no-op then.
    return 0;
  }

  let depth = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    // Cheap prefilter: only queue-operation lines matter.
    if (!line.includes('"queue-operation"')) continue;
    let entry: { type?: string; operation?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // tolerate a torn final line
    }
    if (entry.type !== "queue-operation") continue;
    if (entry.operation === "enqueue") depth += 1;
    else if (entry.operation === "dequeue") depth = Math.max(0, depth - 1);
  }
  return depth;
}

/**
 * True when a resumed session carries a stale, un-drained async-input backlog that
 * the CLI will replay on resume (see {@link countPendingAsyncQueueEntries}).
 */
export async function hasPendingAsyncQueue(sessionFilePath: string): Promise<boolean> {
  return (await countPendingAsyncQueueEntries(sessionFilePath)) > 0;
}
