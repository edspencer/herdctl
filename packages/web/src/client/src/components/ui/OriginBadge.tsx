/**
 * OriginBadge component
 *
 * A compact badge displaying the origin of a session (web, discord, slack, etc.).
 * Uses Lucide icons with optional text labels.
 */

import { Clock, Globe, Hash, MessageCircle, Terminal } from "lucide-react";
import type { SessionOrigin } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface OriginBadgeProps {
  /** The session origin to display */
  origin: SessionOrigin;
  /** Additional CSS classes */
  className?: string;
  /** Show text label next to icon (default: false) */
  showLabel?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the icon component for a given origin
 */
function getOriginIcon(origin: SessionOrigin) {
  switch (origin) {
    case "web":
      return Globe;
    case "discord":
      return MessageCircle;
    case "slack":
      return Hash;
    case "schedule":
      return Clock;
    case "native":
      return Terminal;
  }
}

/**
 * Get the display label for a given origin
 */
function getOriginLabel(origin: SessionOrigin): string {
  switch (origin) {
    case "web":
      return "Web";
    case "discord":
      return "Discord";
    case "slack":
      return "Slack";
    case "schedule":
      return "Schedule";
    case "native":
      return "CLI";
  }
}

// =============================================================================
// Component
// =============================================================================

export function OriginBadge({ origin, className = "", showLabel = false }: OriginBadgeProps) {
  const Icon = getOriginIcon(origin);
  const label = getOriginLabel(origin);

  return (
    <span className={`inline-flex items-center gap-1 text-herd-muted ${className}`} title={label}>
      <Icon className="w-3 h-3" />
      {showLabel && <span className="text-xs">{label}</span>}
    </span>
  );
}
