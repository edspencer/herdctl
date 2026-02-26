/**
 * Chat slice for Zustand store
 *
 * Manages chat sessions, messages, and streaming state for agent conversations.
 */

import type { StateCreator } from "zustand";
import {
  fetchRecentSessions as apiFetchRecentSessions,
  renameChatSession as apiRenameChatSession,
  fetchChatSession,
  fetchChatSessions,
  fetchSessionByPath,
} from "../lib/api";
import type { ChatMessage, ChatSession, ChatToolCall, RecentChatSession } from "../lib/types";

// =============================================================================
// Types
// =============================================================================

/** Maximum number of sessions shown per agent in the sidebar */
const SIDEBAR_SESSION_LIMIT = 5;

export interface ChatState {
  /** List of chat sessions for the current agent */
  chatSessions: ChatSession[];
  /** Loading state for session list */
  chatSessionsLoading: boolean;
  /** Messages for the active session */
  chatMessages: ChatMessage[];
  /** Loading state for message fetch */
  chatMessagesLoading: boolean;
  /** Currently active session ID */
  activeChatSessionId: string | null;
  /** Currently active agent qualified name (for routing WebSocket messages) */
  activeChatAgent: string | null;
  /** Whether the agent is currently streaming a response */
  chatStreaming: boolean;
  /** Accumulated content from streaming chunks */
  chatStreamingContent: string;
  /** Error message for chat operations */
  chatError: string | null;
  /** Recent sessions per agent for sidebar display (keyed by qualifiedName) */
  sidebarSessions: Record<string, ChatSession[]>;
  /** Loading state for sidebar session fetch */
  sidebarSessionsLoading: boolean;
  /** Message grouping preference: "separate" shows each turn as its own bubble, "grouped" merges them */
  messageGrouping: "separate" | "grouped";
  /** Recent sessions across all agents for the Recent Conversations view */
  recentSessions: RecentChatSession[];
  /** Loading state for recent sessions fetch */
  recentSessionsLoading: boolean;
  /** Whether the chat info sidebar is open */
  chatInfoSidebarOpen: boolean;
}

export interface ChatActions {
  /** Fetch all sessions for an agent */
  fetchChatSessions: (agentName: string) => Promise<void>;
  /** Fetch messages for a specific session */
  fetchChatMessages: (agentName: string, sessionId: string) => Promise<void>;
  /** Rename a chat session */
  renameChatSession: (agentName: string, sessionId: string, customName: string) => Promise<void>;
  /** Set the active session and agent */
  setActiveChatSession: (sessionId: string | null, agentName?: string | null) => void;
  /** Append a chunk to streaming content */
  appendStreamingChunk: (chunk: string) => void;
  /** Complete streaming: move content to messages, reset streaming state
   *  @param sessionId - Optional session ID for new chats (sets activeChatSessionId if null)
   */
  completeStreaming: (sessionId?: string) => void;
  /** Add a user message immediately to the messages array */
  addUserMessage: (content: string) => void;
  /** Add a tool call message to the conversation */
  addToolCallMessage: (toolCall: ChatToolCall) => void;
  /** Set chat error state */
  setChatError: (error: string | null) => void;
  /** Fetch recent sessions for all agents (sidebar display) */
  fetchSidebarSessions: (agentNames: string[]) => Promise<void>;
  /** Flush streaming content as a finalized message (on boundary between assistant turns) */
  flushStreamingMessage: () => void;
  /** Set message grouping preference */
  setMessageGrouping: (mode: "separate" | "grouped") => void;
  /** Clear active chat session state (preserves sidebar sessions) */
  clearActiveChatState: () => void;
  /** Clear all chat state */
  clearChatState: () => void;
  /** Fetch recent sessions across all agents */
  fetchRecentSessions: (limit?: number) => Promise<void>;
  /** Update lastMessageAt for a session in recentSessions (for real-time ordering) */
  touchRecentSession: (sessionId: string, agentName: string) => void;
  /** Toggle chat info sidebar visibility */
  toggleChatInfoSidebar: () => void;
  /** Fetch messages for an ad hoc session by path (for unattributed sessions) */
  fetchAdhocChatMessages: (encodedPath: string, sessionId: string) => Promise<void>;
}

export type ChatSlice = ChatState & ChatActions;

// =============================================================================
// Initial State
// =============================================================================

/** Read stored message grouping preference from localStorage */
function getStoredMessageGrouping(): "separate" | "grouped" | null {
  try {
    const stored = localStorage.getItem("herdctl:message_grouping");
    if (stored === "separate" || stored === "grouped") return stored;
  } catch {
    /* ignore storage errors */
  }
  return null;
}

/** Read stored chat info sidebar open state from localStorage */
function getStoredChatInfoSidebarOpen(): boolean {
  try {
    const stored = localStorage.getItem("herdctl:chat_info_sidebar_open");
    if (stored === "false") return false;
  } catch {
    /* ignore storage errors */
  }
  return true; // default: open
}

const initialChatState: ChatState = {
  chatSessions: [],
  chatSessionsLoading: false,
  chatMessages: [],
  chatMessagesLoading: false,
  activeChatSessionId: null,
  activeChatAgent: null,
  chatStreaming: false,
  chatStreamingContent: "",
  chatError: null,
  sidebarSessions: {},
  sidebarSessionsLoading: false,
  messageGrouping: getStoredMessageGrouping() ?? "separate",
  recentSessions: [],
  recentSessionsLoading: false,
  chatInfoSidebarOpen: getStoredChatInfoSidebarOpen(),
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set, get) => ({
  ...initialChatState,

  fetchChatSessions: async (agentName: string) => {
    set({ chatSessionsLoading: true, chatError: null });

    try {
      const response = await fetchChatSessions(agentName);
      set({
        chatSessions: response.sessions,
        chatSessionsLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch chat sessions";
      set({
        chatSessionsLoading: false,
        chatError: message,
      });
    }
  },

  fetchChatMessages: async (agentName: string, sessionId: string) => {
    set({
      chatMessagesLoading: true,
      chatError: null,
      chatStreaming: false,
      chatStreamingContent: "",
    });

    try {
      const response = await fetchChatSession(agentName, sessionId);
      set({
        chatMessages: response.messages,
        chatMessagesLoading: false,
        activeChatSessionId: sessionId,
        activeChatAgent: agentName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch chat messages";
      set({
        chatMessagesLoading: false,
        chatError: message,
      });
    }
  },

  renameChatSession: async (agentName: string, sessionId: string, customName: string) => {
    set({ chatError: null });

    try {
      await apiRenameChatSession(agentName, sessionId, customName);

      set((state) => {
        // Update custom name in main session list
        const chatSessions = state.chatSessions.map((s) =>
          s.sessionId === sessionId ? { ...s, customName } : s,
        );

        // Update custom name in sidebar sessions
        const agentSessions = state.sidebarSessions[agentName];
        const updatedSidebarSessions = agentSessions
          ? {
              ...state.sidebarSessions,
              [agentName]: agentSessions.map((s) =>
                s.sessionId === sessionId ? { ...s, customName } : s,
              ),
            }
          : state.sidebarSessions;

        const recentSessions = state.recentSessions.map((s) =>
          s.sessionId === sessionId ? { ...s, customName } : s,
        );

        return {
          chatSessions,
          sidebarSessions: updatedSidebarSessions,
          recentSessions,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rename chat session";
      set({ chatError: message });
    }
  },

  setActiveChatSession: (sessionId: string | null, agentName?: string | null) => {
    set({
      activeChatSessionId: sessionId,
      activeChatAgent: agentName ?? get().activeChatAgent,
      // Clear messages when switching sessions (will be fetched separately)
      chatMessages: sessionId === null ? [] : get().chatMessages,
      chatStreaming: false,
      chatStreamingContent: "",
    });
  },

  appendStreamingChunk: (chunk: string) => {
    set((state) => ({
      chatStreaming: true,
      chatStreamingContent: state.chatStreamingContent + chunk,
    }));
  },

  completeStreaming: (sessionId?: string) => {
    const { chatStreamingContent, activeChatSessionId } = get();

    if (chatStreamingContent) {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: chatStreamingContent,
        timestamp: new Date().toISOString(),
      };

      set((state) => ({
        chatMessages: [...state.chatMessages, assistantMessage],
        chatStreaming: false,
        chatStreamingContent: "",
        // For new chats, set the active session ID from the completed message
        activeChatSessionId:
          sessionId && activeChatSessionId === null ? sessionId : state.activeChatSessionId,
      }));
    } else {
      set((state) => ({
        chatStreaming: false,
        chatStreamingContent: "",
        // For new chats, set the active session ID from the completed message
        activeChatSessionId:
          sessionId && activeChatSessionId === null ? sessionId : state.activeChatSessionId,
      }));
    }
  },

  addUserMessage: (content: string) => {
    const userMessage: ChatMessage = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    set((state) => ({
      chatMessages: [...state.chatMessages, userMessage],
      chatStreaming: true, // Start streaming state immediately
      chatStreamingContent: "",
    }));
  },

  addToolCallMessage: (toolCall: ChatToolCall) => {
    const { chatStreamingContent } = get();
    const newMessages: ChatMessage[] = [];

    // Flush any accumulated streaming text as its own assistant message
    // so text before and after tool calls renders as separate bubbles
    if (chatStreamingContent) {
      newMessages.push({
        role: "assistant",
        content: chatStreamingContent,
        timestamp: new Date().toISOString(),
      });
    }

    newMessages.push({
      role: "tool",
      content: toolCall.output,
      timestamp: new Date().toISOString(),
      toolCall,
    });

    set((state) => ({
      chatMessages: [...state.chatMessages, ...newMessages],
      chatStreamingContent: "",
    }));
  },

  setChatError: (error: string | null) => {
    set({
      chatError: error,
      chatStreaming: false,
      chatStreamingContent: "",
    });
  },

  fetchSidebarSessions: async (agentNames: string[]) => {
    set({ sidebarSessionsLoading: true });

    try {
      const results = await Promise.all(
        agentNames.map((name) =>
          fetchChatSessions(name, { limit: SIDEBAR_SESSION_LIMIT })
            .then((r) => ({ name, sessions: r.sessions }))
            .catch(() => ({ name, sessions: [] as ChatSession[] })),
        ),
      );

      const sidebarSessions: Record<string, ChatSession[]> = {};
      for (const { name, sessions } of results) {
        sidebarSessions[name] = sessions;
      }

      set({ sidebarSessions, sidebarSessionsLoading: false });
    } catch {
      set({ sidebarSessionsLoading: false });
    }
  },

  flushStreamingMessage: () => {
    const { chatStreamingContent } = get();
    if (chatStreamingContent) {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: chatStreamingContent,
        timestamp: new Date().toISOString(),
      };
      set((state) => ({
        chatMessages: [...state.chatMessages, assistantMessage],
        chatStreamingContent: "",
        // Keep chatStreaming: true because more content is coming
      }));
    }
  },

  setMessageGrouping: (mode: "separate" | "grouped") => {
    set({ messageGrouping: mode });
    try {
      localStorage.setItem("herdctl:message_grouping", mode);
    } catch {
      /* ignore storage errors */
    }
  },

  clearActiveChatState: () => {
    set({
      chatSessions: [],
      chatSessionsLoading: false,
      chatMessages: [],
      chatMessagesLoading: false,
      activeChatSessionId: null,
      activeChatAgent: null,
      chatStreaming: false,
      chatStreamingContent: "",
      chatError: null,
      // sidebarSessions intentionally preserved
    });
  },

  clearChatState: () => {
    set(initialChatState);
  },

  fetchRecentSessions: async (limit = 100) => {
    set({ recentSessionsLoading: true });

    try {
      const sessions = await apiFetchRecentSessions(limit);
      set({
        recentSessions: sessions,
        recentSessionsLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch recent sessions";
      set({
        recentSessionsLoading: false,
        chatError: message,
      });
    }
  },

  touchRecentSession: (sessionId: string, _agentName: string) => {
    set((state) => {
      const idx = state.recentSessions.findIndex((s) => s.sessionId === sessionId);
      if (idx === -1) return state;

      const updated = { ...state.recentSessions[idx], lastMessageAt: new Date().toISOString() };
      const recentSessions = [updated, ...state.recentSessions.filter((_, i) => i !== idx)];
      return { recentSessions };
    });
  },

  toggleChatInfoSidebar: () => {
    set((state) => {
      const newOpen = !state.chatInfoSidebarOpen;
      try {
        localStorage.setItem("herdctl:chat_info_sidebar_open", String(newOpen));
      } catch {
        /* ignore storage errors */
      }
      return { chatInfoSidebarOpen: newOpen };
    });
  },

  fetchAdhocChatMessages: async (encodedPath: string, sessionId: string) => {
    set({
      chatMessagesLoading: true,
      chatError: null,
      chatStreaming: false,
      chatStreamingContent: "",
    });

    try {
      const response = await fetchSessionByPath(encodedPath, sessionId);
      set({
        chatMessages: response.messages,
        chatMessagesLoading: false,
        activeChatSessionId: sessionId,
        activeChatAgent: null, // Ad hoc sessions don't have an associated agent
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch ad hoc chat messages";
      set({
        chatMessagesLoading: false,
        chatError: message,
      });
    }
  },
});
