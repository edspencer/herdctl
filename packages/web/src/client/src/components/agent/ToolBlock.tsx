/**
 * ToolBlock component
 *
 * Collapsible block for displaying tool call output.
 * Shows tool name, icon, and optional duration in header.
 * Body contains the tool content in monospace.
 */

import {
  Bot,
  ChevronRight,
  FileCode,
  FilePen,
  FileText,
  Globe,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { useState } from "react";

// =============================================================================
// Types
// =============================================================================

interface ToolBlockProps {
  /** Name of the tool (e.g., "Bash", "Read", "Edit") */
  toolName: string;
  /** Content/output from the tool call */
  content: string;
  /** Optional duration string (e.g., "1.2s") */
  duration?: string;
  /** Whether to start collapsed (default: true) */
  defaultCollapsed?: boolean;
}

// =============================================================================
// Icon Mapping
// =============================================================================

/**
 * Maps tool name to appropriate Lucide icon.
 * Uses partial matching for flexibility.
 */
function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();

  if (name.includes("bash") || name.includes("terminal") || name.includes("shell")) {
    return Terminal;
  }
  if (name.includes("read") || name.includes("cat")) {
    return FileText;
  }
  if (name.includes("write") || name.includes("create")) {
    return FilePen;
  }
  if (name.includes("edit") || name.includes("patch") || name.includes("modify")) {
    return FileCode;
  }
  if (name.includes("search") || name.includes("grep") || name.includes("find")) {
    return Search;
  }
  if (name.includes("web") || name.includes("fetch") || name.includes("http")) {
    return Globe;
  }
  if (name.includes("task") || name.includes("agent") || name.includes("bot")) {
    return Bot;
  }

  // Default fallback
  return Wrench;
}

// =============================================================================
// Component
// =============================================================================

export function ToolBlock({
  toolName,
  content,
  duration,
  defaultCollapsed = true,
}: ToolBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const Icon = getToolIcon(toolName);

  return (
    <div className="border border-herd-border rounded-lg overflow-hidden">
      {/* Header - always visible, clickable */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-herd-muted hover:bg-herd-hover transition-colors"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${collapsed ? "" : "rotate-90"}`} />
        <Icon className="w-3.5 h-3.5" />
        <span>{toolName}</span>
        {duration && <span className="ml-auto text-[11px] text-herd-muted/60">{duration}</span>}
      </button>

      {/* Body - collapsible */}
      {!collapsed && (
        <div className="px-3 py-2 border-t border-herd-border bg-herd-code-bg text-herd-code-fg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
          {content}
        </div>
      )}
    </div>
  );
}
