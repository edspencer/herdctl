/**
 * AgentChats component
 *
 * Displays all chat sessions for a specific agent with search, rename,
 * delete (two-step confirm), and new chat creation.
 */

import { MessageSquare, Pencil, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatRelativeTime } from "../../lib/format";
import { agentChatPath } from "../../lib/paths";
import type { AgentInfo, ChatSession } from "../../lib/types";
import { useChatActions, useChatSessions } from "../../store";
import { OriginBadge } from "../ui/OriginBadge";

// =============================================================================
// Types
// =============================================================================

interface AgentChatsProps {
  agent: AgentInfo;
}

// =============================================================================
// Sub-Components
// =============================================================================

interface ChatRowProps {
  session: ChatSession;
  agentName: string;
  isActive: boolean;
  onRename: (sessionId: string, name: string) => void;
}

function ChatRow({ session, agentName, isActive, onRename }: ChatRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const displayName = session.customName || session.preview || "New conversation";

  const startEditing = () => {
    setIsEditing(true);
    setEditValue(displayName);
  };

  const handleSave = () => {
    if (editValue.trim()) {
      onRename(session.sessionId, editValue.trim());
    }
    setIsEditing(false);
    setEditValue("");
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue("");
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-herd-hover">
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
          className="flex-1 bg-transparent border-none outline-none text-sm text-herd-fg transition-colors min-w-0"
        />
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
        !session.resumable ? "opacity-60" : ""
      } ${
        isActive
          ? "text-herd-fg bg-herd-hover"
          : "text-herd-muted hover:bg-herd-hover hover:text-herd-fg"
      }`}
    >
      <Link
        to={agentChatPath(agentName, session.sessionId)}
        className="flex-1 min-w-0 flex flex-col gap-0.5"
      >
        <span className="truncate font-medium text-herd-fg">{displayName}</span>
        <span className="text-[11px] text-herd-muted">
          {session.messageCount} {session.messageCount === 1 ? "message" : "messages"}
          <span className="mx-1 text-herd-muted/40">&middot;</span>
          {formatRelativeTime(session.lastMessageAt)}
        </span>
      </Link>

      {/* Origin badge */}
      <OriginBadge origin={session.origin} className="flex-shrink-0" />

      {/* Rename button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startEditing();
        }}
        className="p-1 hover:bg-herd-border rounded opacity-0 group-hover:opacity-100 transition-opacity"
        title="Rename chat"
      >
        <Pencil className="w-3.5 h-3.5 text-herd-muted hover:text-herd-fg" />
      </button>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function AgentChats({ agent }: AgentChatsProps) {
  const navigate = useNavigate();
  const { chatSessions, chatSessionsLoading } = useChatSessions();
  const { fetchChatSessions, renameChatSession } = useChatActions();
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch sessions on mount
  useEffect(() => {
    fetchChatSessions(agent.qualifiedName);
  }, [fetchChatSessions, agent.qualifiedName]);

  // Filter sessions by search
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return chatSessions;
    const query = searchQuery.toLowerCase().trim();
    return chatSessions.filter((session) => {
      if (session.customName?.toLowerCase().includes(query)) return true;
      if (session.preview?.toLowerCase().includes(query)) return true;
      return false;
    });
  }, [chatSessions, searchQuery]);

  const handleRename = useCallback(
    async (sessionId: string, name: string) => {
      await renameChatSession(agent.qualifiedName, sessionId, name);
      fetchChatSessions(agent.qualifiedName);
    },
    [renameChatSession, fetchChatSessions, agent.qualifiedName],
  );

  // Navigate to new chat (session is created on first message)
  const handleNewChat = useCallback(() => {
    navigate(agentChatPath(agent.qualifiedName));
  }, [navigate, agent.qualifiedName]);

  // Loading state
  if (chatSessionsLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
            <div className="flex-1 space-y-1.5">
              <div className="h-4 bg-herd-muted/20 rounded w-3/4" />
              <div className="h-3 bg-herd-muted/10 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (chatSessions.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-8">
        <MessageSquare className="w-8 h-8 text-herd-muted/40 mb-3" />
        <p className="text-sm text-herd-muted mb-1">No conversations yet</p>
        <p className="text-xs text-herd-muted/70 mb-4">Start a conversation with {agent.name}</p>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center gap-1.5 bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search + New Chat */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-herd-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full bg-herd-input-bg border border-herd-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-herd-fg placeholder:text-herd-muted focus:outline-none focus:border-herd-primary/60 transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex-shrink-0 flex items-center gap-1.5 bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="space-y-0.5">
        {filteredSessions.length === 0 ? (
          <p className="text-xs text-herd-muted px-3 py-2">No matches for "{searchQuery}"</p>
        ) : (
          filteredSessions.map((session) => (
            <ChatRow
              key={session.sessionId}
              session={session}
              agentName={agent.qualifiedName}
              isActive={false}
              onRename={handleRename}
            />
          ))
        )}
      </div>

      {/* Summary */}
      <p className="text-[11px] text-herd-muted text-center pt-2">
        {chatSessions.length} {chatSessions.length === 1 ? "conversation" : "conversations"}
      </p>
    </div>
  );
}
