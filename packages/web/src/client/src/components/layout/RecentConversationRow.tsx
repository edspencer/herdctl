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

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { getAgentAvatar } from "../../lib/avatar";
import { formatRelativeTime } from "../../lib/format";
import { agentChatPath } from "../../lib/paths";
import type { RecentChatSession } from "../../lib/types";

interface RecentConversationRowProps {
  session: RecentChatSession;
  isActive: boolean;
  onNavigate?: () => void;
  onRename: (agentName: string, sessionId: string, name: string) => void;
  onDelete: (agentName: string, sessionId: string) => Promise<void>;
}

export function RecentConversationRow({
  session,
  isActive,
  onNavigate,
  onRename,
  onDelete,
}: RecentConversationRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const conversationName = session.customName || session.preview || "New conversation";

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

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDeleting(true);
    setConfirmDelete(false);
    await onDelete(session.agentName, session.sessionId);
    setIsDeleting(false);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(false);
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
        isDeleting ? "opacity-50" : ""
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

      {/* Content area with navigation link */}
      <Link
        to={agentChatPath(session.agentName, session.sessionId)}
        onClick={onNavigate}
        className="flex-1 min-w-0 flex flex-col"
      >
        {/* Conversation name (primary) */}
        <span className="truncate">{conversationName}</span>
        {/* Agent name (secondary) */}
        <span className="text-[11px] text-herd-sidebar-muted truncate">{session.agentName}</span>
      </Link>

      {/* Action buttons or confirm delete */}
      {confirmDelete ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={handleConfirmDelete}
            className="p-0.5 hover:bg-herd-sidebar-active rounded"
            title="Confirm delete"
          >
            <Trash2 className="w-3 h-3 text-herd-status-error" />
          </button>
          <button
            type="button"
            onClick={handleCancelDelete}
            className="text-herd-sidebar-muted hover:text-herd-sidebar-fg text-[10px] px-0.5"
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
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
          <button
            type="button"
            onClick={handleDeleteClick}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-herd-sidebar-active rounded"
            title="Delete chat"
          >
            <Trash2 className="w-3 h-3 text-herd-sidebar-muted hover:text-herd-status-error" />
          </button>
        </>
      )}

      {/* Timestamp */}
      <span className="flex-shrink-0 text-herd-sidebar-muted/60 text-[10px]">
        {formatRelativeTime(session.lastMessageAt)}
      </span>
    </div>
  );
}
