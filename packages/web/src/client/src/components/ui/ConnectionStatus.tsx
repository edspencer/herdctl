/**
 * ConnectionStatus bar component
 *
 * A thin bar at the top of the app that shows WebSocket connection state.
 * Hidden when connected (after a brief "Reconnected" flash).
 * Shows yellow for connecting, red for disconnected, green for reconnected.
 */

import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus as ConnectionStatusType } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface ConnectionStatusProps {
  /** Current WebSocket connection status */
  status: ConnectionStatusType;
}

type BarState = "hidden" | "connecting" | "disconnected" | "reconnected";

// =============================================================================
// Component
// =============================================================================

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const [barState, setBarState] = useState<BarState>("hidden");
  const prevStatusRef = useRef<ConnectionStatusType>(status);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    // Clear any existing dismiss timer
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    if (status === "connected") {
      // Show "Reconnected" briefly only if transitioning from disconnected/reconnecting
      if (prevStatus === "disconnected" || prevStatus === "reconnecting") {
        setBarState("reconnected");
        dismissTimerRef.current = setTimeout(() => {
          setBarState("hidden");
        }, 2000);
      } else {
        setBarState("hidden");
      }
    } else if (status === "reconnecting") {
      setBarState("connecting");
    } else if (status === "disconnected") {
      setBarState("disconnected");
    }

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [status]);

  if (barState === "hidden") {
    return null;
  }

  const barConfig = {
    connecting: {
      bg: "bg-herd-status-pending/15",
      text: "text-herd-status-pending",
      border: "border-b border-herd-status-pending/20",
      icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
      message: "Connecting to server...",
    },
    disconnected: {
      bg: "bg-herd-status-error/15",
      text: "text-herd-status-error",
      border: "border-b border-herd-status-error/20",
      icon: <WifiOff className="w-3.5 h-3.5" />,
      message: "Disconnected from server. Retrying...",
    },
    reconnected: {
      bg: "bg-herd-status-running/15",
      text: "text-herd-status-running",
      border: "border-b border-herd-status-running/20",
      icon: <Wifi className="w-3.5 h-3.5" />,
      message: "Reconnected",
    },
  } as const;

  const config = barConfig[barState];

  return (
    <div
      className={`
        flex items-center justify-center gap-2 h-8 px-3 text-xs font-medium
        animate-fade-slide-in
        ${config.bg} ${config.text} ${config.border}
      `}
    >
      {config.icon}
      <span>{config.message}</span>
    </div>
  );
}
