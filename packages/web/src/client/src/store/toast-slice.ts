/**
 * Toast slice for Zustand store
 *
 * Manages toast notifications: add, remove, auto-dismiss.
 */

import type { StateCreator } from "zustand";

// =============================================================================
// State Types
// =============================================================================

export type ToastType = "success" | "error" | "info";

export interface Toast {
  /** Unique identifier */
  id: string;
  /** Toast message */
  message: string;
  /** Toast type (determines color) */
  type: ToastType;
  /** Auto-dismiss duration in ms (default: 3000) */
  duration?: number;
}

export interface ToastState {
  /** Active toasts */
  toasts: Toast[];
}

export interface ToastActions {
  /** Add a toast notification */
  addToast: (toast: Omit<Toast, "id">) => void;
  /** Remove a toast by ID */
  removeToast: (id: string) => void;
}

export type ToastSlice = ToastState & ToastActions;

// =============================================================================
// Helpers
// =============================================================================

let toastCounter = 0;

function generateToastId(): string {
  toastCounter += 1;
  return `toast-${toastCounter}-${Date.now()}`;
}

// =============================================================================
// Initial State
// =============================================================================

const initialToastState: ToastState = {
  toasts: [],
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createToastSlice: StateCreator<ToastSlice, [], [], ToastSlice> = (set) => ({
  ...initialToastState,

  addToast: (toast) => {
    const id = generateToastId();
    const duration = toast.duration ?? 3000;

    set((state) => ({
      toasts: [...state.toasts, { ...toast, id, duration }],
    }));

    // Auto-dismiss after duration
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
});
