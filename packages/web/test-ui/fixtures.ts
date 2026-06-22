/**
 * Playwright fixtures for @herdctl/web UI/integration tests.
 *
 * Exposes a `harness` fixture that boots a fresh real web server + FleetManager
 * (with a temp fleet + fake claude) for each test that requests it, and tears it
 * down afterwards. Tests that don't need a custom fleet get a sensible default.
 */

import { test as base } from "@playwright/test";
import { type Harness, type HarnessOptions, startHarness } from "./harness.js";

export interface Fixtures {
  /** Options for the default harness. Override per-test via test.use({...}). */
  harnessOptions: HarnessOptions;
  /** A live harness: real web server + FleetManager + fake claude. */
  harness: Harness;
}

export const test = base.extend<Fixtures>({
  harnessOptions: [{}, { option: true }],

  harness: async ({ harnessOptions }, use) => {
    const harness = await startHarness(harnessOptions);
    try {
      await use(harness);
    } finally {
      await harness.stop();
    }
  },
});

export { expect } from "@playwright/test";
