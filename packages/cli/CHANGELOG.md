# herdctl

## 0.1.0

### Minor Changes

- [`b5bb261`](https://github.com/edspencer/herdctl/commit/b5bb261247e65551a15c1fc4451c867b666feefe) Thanks [@edspencer](https://github.com/edspencer)! - Fix trigger command to actually execute jobs

  Previously, `herdctl trigger <agent>` would create a job metadata file but never
  actually run the agent. The job would stay in "pending" status forever.

  Now trigger() uses JobExecutor to:

  - Create the job record
  - Execute the agent via Claude SDK
  - Stream output to job log
  - Update job status on completion

  This is a minor version bump as it adds new behavior (job execution) rather than
  breaking existing APIs. The trigger() method signature is unchanged.

### Patch Changes

- Updated dependencies [[`b5bb261`](https://github.com/edspencer/herdctl/commit/b5bb261247e65551a15c1fc4451c867b666feefe), [`6eca6b3`](https://github.com/edspencer/herdctl/commit/6eca6b33458f99b2edc43e42a78d88984964b5d8)]:
  - @herdctl/core@0.1.0

## 0.0.2

### Patch Changes

- [`38d8f12`](https://github.com/edspencer/herdctl/commit/38d8f12c13afbfb974444acf23d82d51d38b0844) Thanks [@edspencer](https://github.com/edspencer)! - Initial changesets setup for automated npm publishing

- Updated dependencies [[`38d8f12`](https://github.com/edspencer/herdctl/commit/38d8f12c13afbfb974444acf23d82d51d38b0844)]:
  - @herdctl/core@0.0.2
