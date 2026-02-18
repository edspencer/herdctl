/**
 * ConnectionBanner component
 *
 * Displays a banner when the WebSocket connection is lost or reconnecting.
 * Auto-dismisses when connection is restored.
 */

import { RefreshCw, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface ConnectionBannerProps {
  /** Current WebSocket connection status */
  status: ConnectionStatus;
  /** Optional callback to manually retry connection */
  onRetry?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function ConnectionBanner({ status, onRetry }: ConnectionBannerProps) {
  // Don't render when connected
  if (status === "connected") {
    return null;
  }

  const isReconnecting = status === "reconnecting";

  return (
    <div
      className={`
        flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
        animate-fade-slide-in
        ${
          isReconnecting
            ? "bg-herd-status-pending/15 text-herd-status-pending border-b border-herd-status-pending/20"
            : "bg-herd-status-error/15 text-herd-status-error border-b border-herd-status-error/20"
        }
      `}
    >
      {isReconnecting ? (
        <>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Reconnecting to server...</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          <span>Connection lost</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="ml-2 px-2 py-0.5 rounded bg-herd-status-error/20 hover:bg-herd-status-error/30 transition-colors"
            >
              Retry
            </button>
          )}
        </>
      )}
    </div>
  );
}
