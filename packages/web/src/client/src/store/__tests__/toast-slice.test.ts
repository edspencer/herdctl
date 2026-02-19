/**
 * Toast slice tests
 *
 * Tests toast notification add/remove behavior in the Zustand store.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { create } from "zustand";
import { createToastSlice, type ToastSlice } from "../toast-slice";

// =============================================================================
// Helpers
// =============================================================================

function createTestStore() {
  return create<ToastSlice>()((...args) => createToastSlice(...args));
}

// =============================================================================
// Tests
// =============================================================================

describe("Toast Slice", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createTestStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("has empty toasts array", () => {
      expect(store.getState().toasts).toEqual([]);
    });
  });

  describe("addToast", () => {
    it("adds a toast notification", () => {
      store.getState().addToast({ message: "Success!", type: "success" });

      const { toasts } = store.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe("Success!");
      expect(toasts[0].type).toBe("success");
      expect(toasts[0].id).toBeDefined();
    });

    it("generates unique IDs for each toast", () => {
      store.getState().addToast({ message: "First", type: "info" });
      store.getState().addToast({ message: "Second", type: "info" });

      const { toasts } = store.getState();
      expect(toasts).toHaveLength(2);
      expect(toasts[0].id).not.toBe(toasts[1].id);
    });

    it("supports different toast types", () => {
      store.getState().addToast({ message: "OK", type: "success" });
      store.getState().addToast({ message: "Oops", type: "error" });
      store.getState().addToast({ message: "FYI", type: "info" });

      const { toasts } = store.getState();
      expect(toasts[0].type).toBe("success");
      expect(toasts[1].type).toBe("error");
      expect(toasts[2].type).toBe("info");
    });

    it("sets default duration of 3000ms", () => {
      store.getState().addToast({ message: "Default duration", type: "info" });
      expect(store.getState().toasts[0].duration).toBe(3000);
    });

    it("accepts custom duration", () => {
      store.getState().addToast({ message: "Custom", type: "info", duration: 5000 });
      expect(store.getState().toasts[0].duration).toBe(5000);
    });

    it("auto-removes toast after duration", () => {
      store.getState().addToast({ message: "Temporary", type: "info", duration: 3000 });

      expect(store.getState().toasts).toHaveLength(1);

      vi.advanceTimersByTime(3000);

      expect(store.getState().toasts).toHaveLength(0);
    });

    it("does not auto-remove toast with duration 0", () => {
      store.getState().addToast({ message: "Persistent", type: "info", duration: 0 });

      expect(store.getState().toasts).toHaveLength(1);

      vi.advanceTimersByTime(10000);

      // Should still be there
      expect(store.getState().toasts).toHaveLength(1);
    });
  });

  describe("removeToast", () => {
    it("removes a toast by ID", () => {
      // Use duration 0 to prevent auto-removal during test
      store.getState().addToast({ message: "First", type: "info", duration: 0 });
      store.getState().addToast({ message: "Second", type: "info", duration: 0 });

      const firstId = store.getState().toasts[0].id;
      store.getState().removeToast(firstId);

      const { toasts } = store.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe("Second");
    });

    it("does nothing when ID does not exist", () => {
      store.getState().addToast({ message: "Only", type: "info", duration: 0 });

      store.getState().removeToast("nonexistent-id");

      expect(store.getState().toasts).toHaveLength(1);
    });

    it("removes the correct toast from middle of list", () => {
      store.getState().addToast({ message: "A", type: "info", duration: 0 });
      store.getState().addToast({ message: "B", type: "error", duration: 0 });
      store.getState().addToast({ message: "C", type: "success", duration: 0 });

      const middleId = store.getState().toasts[1].id;
      store.getState().removeToast(middleId);

      const { toasts } = store.getState();
      expect(toasts).toHaveLength(2);
      expect(toasts[0].message).toBe("A");
      expect(toasts[1].message).toBe("C");
    });
  });
});
