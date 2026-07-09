/**
 * {@link WakePersistence} backed by the fleet state file (`.herdctl/state.yaml`).
 *
 * Session wakes live under the top-level `session_wakes` record, keyed by SDK
 * cron id. Reads/writes go through the same atomic `readFleetState` /
 * `writeFleetState` helpers the scheduler uses, so wakes are durable across a
 * fleet restart alongside the rest of fleet state.
 */

import { join } from "node:path";
import { readFleetState, writeFleetState } from "../state/fleet-state.js";
import { STATE_FILE_NAME } from "../state/types.js";
import type { SessionWakeEntry } from "./types.js";
import type { WakePersistence } from "./wake-registry.js";

export interface FleetStateWakePersistenceOptions {
  /** The state directory (`.herdctl`); the state file is `<stateDir>/state.yaml`. */
  stateDir: string;
}

/**
 * Persist the session-wake set inside the fleet state file. The registry's
 * async lock serializes calls, so read-modify-write here is race-free within the
 * fleet process.
 */
export class FleetStateWakePersistence implements WakePersistence {
  private readonly stateFilePath: string;

  constructor(options: FleetStateWakePersistenceOptions) {
    this.stateFilePath = join(options.stateDir, STATE_FILE_NAME);
  }

  async load(): Promise<SessionWakeEntry[]> {
    const state = await readFleetState(this.stateFilePath);
    return Object.values(state.session_wakes ?? {});
  }

  async save(entries: SessionWakeEntry[]): Promise<void> {
    const state = await readFleetState(this.stateFilePath);
    const session_wakes: Record<string, SessionWakeEntry> = {};
    for (const entry of entries) {
      session_wakes[entry.id] = entry;
    }
    await writeFleetState(this.stateFilePath, { ...state, session_wakes });
  }
}
