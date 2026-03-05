import { stopCommand } from "./stop.js";
import type { SlashCommand } from "./types.js";

export const cancelCommand: SlashCommand = {
  name: "cancel",
  description: "Alias for /stop",
  execute: stopCommand.execute,
};
