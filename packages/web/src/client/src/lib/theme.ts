/**
 * Theme utility module for @herdctl/web
 *
 * Manages light/dark/system theme preferences using CSS class-based dark mode.
 * Theme is stored in localStorage under the "herd-theme" key.
 * The `dark` class is toggled on the `<html>` element.
 */

import type { Theme } from "./types";

// =============================================================================
// Constants
// =============================================================================

const THEME_STORAGE_KEY = "herd-theme";

// =============================================================================
// Theme Functions
// =============================================================================

/**
 * Read the stored theme preference from localStorage.
 * Returns "system" if nothing is stored or the value is invalid.
 */
export function getStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }

  return "system";
}

/**
 * Resolve the effective theme ("light" or "dark") from a preference.
 * When the preference is "system", uses the OS-level prefers-color-scheme query.
 */
export function getEffectiveTheme(theme?: Theme): "light" | "dark" {
  const preference = theme ?? getStoredTheme();

  if (preference === "system") {
    if (typeof window === "undefined") {
      return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return preference;
}

/**
 * Apply a theme to the DOM by toggling the `dark` class on `<html>`.
 * Does not write to localStorage.
 */
export function applyTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }

  const effective = getEffectiveTheme(theme);
  document.documentElement.classList.toggle("dark", effective === "dark");
}

/**
 * Set the theme: writes to localStorage and applies to the DOM.
 */
export function setTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

/**
 * Initialize the theme system. Call once on app startup.
 *
 * - Reads stored preference from localStorage
 * - Applies it to the DOM
 * - Sets up a listener for OS-level theme changes (for "system" mode)
 *
 * Returns a cleanup function that removes the media query listener.
 */
export function initTheme(): () => void {
  const stored = getStoredTheme();
  applyTheme(stored);

  // Listen for OS-level changes when using "system" preference
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function handleSystemChange(e: MediaQueryListEvent): void {
    const currentTheme = getStoredTheme();
    if (currentTheme === "system") {
      document.documentElement.classList.toggle("dark", e.matches);
    }
  }

  mediaQuery.addEventListener("change", handleSystemChange);

  return () => {
    mediaQuery.removeEventListener("change", handleSystemChange);
  };
}
