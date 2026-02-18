/**
 * Toast notification components
 *
 * Displays toast notifications in a fixed container at bottom-right.
 * Toasts auto-dismiss and support success, error, and info types.
 */

import { CheckCircle, XCircle, Info, X } from "lucide-react";
import { useToasts, useToastActions } from "../../store";
import type { ToastType, Toast } from "../../store";

// =============================================================================
// Helper Functions
// =============================================================================

function getToastIcon(type: ToastType) {
  switch (type) {
    case "success":
      return <CheckCircle className="w-4 h-4 text-herd-status-running flex-shrink-0" />;
    case "error":
      return <XCircle className="w-4 h-4 text-herd-status-error flex-shrink-0" />;
    case "info":
      return <Info className="w-4 h-4 text-herd-primary flex-shrink-0" />;
  }
}

function getToastClasses(type: ToastType): string {
  switch (type) {
    case "success":
      return "bg-herd-status-running/10 border-herd-status-running/20";
    case "error":
      return "bg-herd-status-error/10 border-herd-status-error/20";
    case "info":
      return "bg-herd-primary-muted border-herd-primary/20";
  }
}

// =============================================================================
// Toast Item
// =============================================================================

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-2 rounded-[10px] border text-sm text-herd-fg
        animate-fade-slide-in min-w-[240px] max-w-[360px]
        ${getToastClasses(toast.type)}
      `}
    >
      {getToastIcon(toast.type)}
      <span className="flex-1 text-xs">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="hover:bg-herd-hover rounded p-0.5 transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5 text-herd-muted" />
      </button>
    </div>
  );
}

// =============================================================================
// Toast Container
// =============================================================================

export function ToastContainer() {
  const toasts = useToasts();
  const { removeToast } = useToastActions();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}
