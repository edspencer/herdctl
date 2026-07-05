/**
 * Runtime module barrel export
 *
 * Exports public runtime API:
 * - RuntimeInterface and RuntimeExecuteOptions types
 * - SDKRuntime implementation
 * - RuntimeFactory for runtime instantiation
 * - RuntimeType for type identification
 *
 * Internal consumers import directly from sub-modules.
 */

// CLI / Docker session path utilities — locate Claude session files and
// transcript directories. Exported on the public surface so consumers can
// compute a session's transcript path (e.g. to delete it) without
// deep-importing `dist/runner/runtime/cli-session-path.js`.
export {
  encodePathForCli,
  getCliSessionDir,
  getCliSessionFile,
  getDockerSessionDir,
  getDockerSessionFile,
  readSessionCwd,
  sessionBelongsToWorkingDirectory,
} from "./cli-session-path.js";
export { RuntimeFactory, type RuntimeType } from "./factory.js";
export type { RuntimeExecuteOptions, RuntimeInterface, RuntimeSession } from "./interface.js";
export { MessageQueue } from "./message-queue.js";
export { SDKRuntime } from "./sdk-runtime.js";
