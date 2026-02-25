/**
 * RecentConversationRow component
 *
 * A single row in the Recent Conversations list, displaying:
 * - Agent avatar (20px)
 * - Agent name (secondary context)
 * - Conversation name (primary text)
 * - Relative timestamp
 * - Hover actions: rename (Pencil) and delete (Trash2 with two-step confirm)
 *
 * Uses herd-* design tokens for styling.
 */

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { getAgentAvatar } from "../../lib/avatar";
import { formatRelativeTime } from "../../lib/format";
import { adhocChatPath, agentChatPath, readOnlySessionPath } from "../../lib/paths";
import type { RecentChatSession } from "../../lib/types";
import { OriginBadge } from "../ui/OriginBadge";

interface RecentConversationRowProps {
  session: RecentChatSession;
  isActive: boolean;
  onNavigate?: () => void;
  onRename: (agentName: string, sessionId: string, name: string) => void;
}

export function RecentConversationRow({
  session,
  isActive,
  onNavigate,
  onRename,
}: RecentConversationRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const conversationName =
    session.customName || session.autoName || session.preview || "New conversation";

  // Route to agent chat if attributed, ad hoc chat if unattributed+resumable, or read-only otherwise
  const sessionPath =
    session.agentName && session.agentName.length > 0
      ? agentChatPath(session.agentName, session.sessionId)
      : session.encodedPath && session.resumable
        ? adhocChatPath(session.encodedPath, session.sessionId)
        : session.encodedPath
          ? readOnlySessionPath(session.encodedPath, session.sessionId)
          : null;

  const startEditing = () => {
    setIsEditing(true);
    setEditValue(conversationName);
  };

  const handleSave = () => {
    if (editValue.trim()) {
      onRename(session.agentName, session.sessionId, editValue.trim());
    }
    setIsEditing(false);
    setEditValue("");
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue("");
  };

  // Edit mode rendering
  if (isEditing) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded bg-herd-sidebar-hover">
        <img
          src={getAgentAvatar(session.agentName)}
          alt=""
          className="w-5 h-5 rounded flex-shrink-0"
        />
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              handleCancel();
            }
          }}
          onBlur={() => handleCancel()}
          className="flex-1 bg-transparent border-none outline-none text-sm text-herd-sidebar-fg focus:bg-herd-sidebar-hover transition-colors min-w-0"
        />
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
        !session.resumable ? "opacity-60" : ""
      } ${
        isActive
          ? "text-herd-sidebar-fg bg-herd-sidebar-active"
          : "text-herd-sidebar-muted hover:bg-herd-sidebar-hover hover:text-herd-sidebar-fg"
      }`}
    >
      {/* Agent avatar */}
      <img
        src={getAgentAvatar(session.agentName)}
        alt=""
        className="w-5 h-5 rounded flex-shrink-0"
      />

      {/* Origin badge */}
      <OriginBadge origin={session.origin} className="flex-shrink-0" />

      {/* Content area with navigation link */}
      {sessionPath ? (
        <Link to={sessionPath} onClick={onNavigate} className="flex-1 min-w-0 flex flex-col">
          <span className="truncate">{conversationName}</span>
          <span className="text-[11px] text-herd-sidebar-muted truncate">
            {session.agentName || "Unattributed"}
          </span>
        </Link>
      ) : (
        <div className="flex-1 min-w-0 flex flex-col opacity-60">
          <span className="truncate">{conversationName}</span>
          <span className="text-[11px] text-herd-sidebar-muted truncate">Unattributed</span>
        </div>
      )}

      {/* Rename button (only for attributed sessions) */}
      {session.agentName && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startEditing();
          }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-herd-sidebar-active rounded"
          title="Rename chat"
        >
          <Pencil className="w-3 h-3 text-herd-sidebar-muted hover:text-herd-sidebar-fg" />
        </button>
      )}

      {/* Timestamp */}
      <span className="flex-shrink-0 text-herd-sidebar-muted/60 text-[10px]">
        {formatRelativeTime(session.lastMessageAt)}
      </span>
    </div>
  );
}
