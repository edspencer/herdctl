/**
 * Deterministic agent avatar generation using DiceBear bottts.
 *
 * Generates a bottts robot avatar data URI for a given seed string (agent name).
 * Results are cached at module level so each seed is only generated once.
 */

import * as bottts from "@dicebear/bottts";
import { createAvatar } from "@dicebear/core";

const avatarCache = new Map<string, string>();

/**
 * Get a deterministic fun-emoji avatar data URI for a seed string.
 */
export function getAgentAvatar(seed: string): string {
  let uri = avatarCache.get(seed);
  if (!uri) {
    const avatar = createAvatar(bottts, { seed });
    uri = avatar.toDataUri();
    avatarCache.set(seed, uri);
  }
  return uri;
}
