/**
 * ASCII art banner for herdctl start
 *
 * Gradient from light blue to deep navy, centered on herdctl brand blue (#326CE5).
 * Respects NO_COLOR / FORCE_COLOR / TTY detection via shouldUseColor().
 */

import { shouldUseColor } from "./colors.js";

const BANNER_LINES = [
  "                ▃▃▂                               ▗▃▃                  ▃▃▃                ",
  "                ██▊                               ▐█▉            ▐▇▇   ██▊                ",
  "                ██▊▃▅▅▅▃    ▃▅▅▅▅▃   ▄▄▖▃▅▅  ▂▄▅▅▃▐█▉   ▂▄▅▅▅▃  ▄▟██▄▖ ██▊                ",
  "                ███▛▀▀██▊  ▟█▛▀▀▜█▙  ████▛▊ ▟██▀▀▜██▉  ▟██▀▀▜██▖▀▜██▀▘ ██▊                ",
  "                ██▊   ▜█▉ ▐██▄▄▄▄██▌ ██▊   ▐██▎   ▜█▉ ▕██▍   ▀▀▘ ▐██   ██▊                ",
  "                ██▊   ▐█▉ ▐██▀▀▀▀▀▀▘ ██▋   ▐██▎   ▐█▉ ▐██▎   ▂▂  ▐██   ██▊                ",
  "                ██▊   ▐█▉ ▝██▙▃▃▟██▘ ██▋    ▜██▄▃▅██▉  ▜██▄▃▟██  ▐██▃▖ ██▊                ",
  "                ▀▀▘   ▝▀▀   ▀▀▜▛▀▀   ▀▀▘     ▀▀█▀▀▝▀▀   ▀▀▜▛▀▀    ▀▀▀▘ ▀▀▘                ",
];

/** RGB gradient stops from light blue → herdctl blue → deep navy */
const GRADIENT: [number, number, number][] = [
  [165, 216, 255],
  [130, 195, 255],
  [95, 172, 248],
  [70, 148, 240],
  [50, 108, 229],
  [40, 88, 200],
  [32, 70, 175],
  [25, 55, 145],
];

function rgb(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

const RESET = "\x1b[0m";

/**
 * Return the herdctl banner string, colorized if the terminal supports it.
 */
export function getBanner(): string {
  const useColor = shouldUseColor();

  if (!useColor) {
    return `\n${BANNER_LINES.join("\n")}\n`;
  }

  const colored = BANNER_LINES.map((line, i) => {
    const [r, g, b] = GRADIENT[i];
    return `${rgb(r, g, b)}${line}${RESET}`;
  });

  return `\n${colored.join("\n")}\n`;
}
