/**
 * Chat slice for Zustand store
 *
 * Manages chat sessions, messages, and streaming state for agent conversations.
 */

import type { StateCreator } from "zustand";
import {
  createChatSession as apiCreateChatSession,
  deleteChatSession as apiDeleteChatSession,
  fetchChatSession,
  fetchChatSessions,
} from "../lib/api";
import type { ChatMessage, ChatSession, ChatToolCall } from "../lib/types";

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
}

export interface ChatActions {
  /** Fetch all sessions for an agent */
  fetchChatSessions: (agentName: string) => Promise<void>;
  /** Fetch messages for a specific session */
  fetchChatMessages: (agentName: string, sessionId: string) => Promise<void>;
  /** Create a new chat session */
  createChatSession: (agentName: string) => Promise<string | null>;
  /** Delete a chat session */
  deleteChatSession: (agentName: string, sessionId: string) => Promise<void>;
  /** Set the active session */
  setActiveChatSession: (sessionId: string | null) => void;
  /** Append a chunk to streaming content */
  appendStreamingChunk: (chunk: string) => void;
  /** Complete streaming: move content to messages, reset streaming state */
  completeStreaming: () => void;
  /** Add a user message immediately to the messages array */
  addUserMessage: (content: string) => void;
  /** Add a tool call message to the conversation */
  addToolCallMessage: (toolCall: ChatToolCall) => void;
  /** Set chat error state */
  setChatError: (error: string | null) => void;
  /** Fetch recent sessions for all agents (sidebar display) */
  fetchSidebarSessions: (agentNames: string[]) => Promise<void>;
  /** Clear active chat session state (preserves sidebar sessions) */
  clearActiveChatState: () => void;
  /** Clear all chat state */
  clearChatState: () => void;
}

export type ChatSlice = ChatState & ChatActions;

// =============================================================================
// Initial State
// =============================================================================

const initialChatState: ChatState = {
  chatSessions: [],
  chatSessionsLoading: false,
  chatMessages: [],
  chatMessagesLoading: false,
  activeChatSessionId: null,
  chatStreaming: false,
  chatStreamingContent: "",
  chatError: null,
  sidebarSessions: {},
  sidebarSessionsLoading: false,
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch chat messages";
      set({
        chatMessagesLoading: false,
        chatError: message,
      });
    }
  },

  createChatSession: async (agentName: string) => {
    set({ chatError: null });

    try {
      const response = await apiCreateChatSession(agentName);
      const newSession: ChatSession = {
        sessionId: response.sessionId,
        createdAt: response.createdAt,
        lastMessageAt: response.createdAt,
        messageCount: 0,
        preview: "",
      };

      set((state) => {
        // Update the main session list
        const chatSessions = [newSession, ...state.chatSessions];

        // Also update sidebar sessions so the new chat appears immediately
        const agentSessions = state.sidebarSessions[agentName] ?? [];
        const updatedAgentSessions = [newSession, ...agentSessions].slice(0, SIDEBAR_SESSION_LIMIT);

        return {
          chatSessions,
          activeChatSessionId: response.sessionId,
          chatMessages: [],
          sidebarSessions: {
            ...state.sidebarSessions,
            [agentName]: updatedAgentSessions,
          },
        };
      });

      return response.sessionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create chat session";
      set({ chatError: message });
      return null;
    }
  },

  deleteChatSession: async (agentName: string, sessionId: string) => {
    set({ chatError: null });

    try {
      await apiDeleteChatSession(agentName, sessionId);

      const { activeChatSessionId } = get();

      set((state) => {
        // Also remove from sidebar sessions
        const agentSessions = state.sidebarSessions[agentName];
        const updatedSidebarSessions = agentSessions
          ? {
              ...state.sidebarSessions,
              [agentName]: agentSessions.filter((s) => s.sessionId !== sessionId),
            }
          : state.sidebarSessions;

        return {
          chatSessions: state.chatSessions.filter((s) => s.sessionId !== sessionId),
          activeChatSessionId: activeChatSessionId === sessionId ? null : activeChatSessionId,
          chatMessages: activeChatSessionId === sessionId ? [] : state.chatMessages,
          sidebarSessions: updatedSidebarSessions,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete chat session";
      set({ chatError: message });
    }
  },

  setActiveChatSession: (sessionId: string | null) => {
    set({
      activeChatSessionId: sessionId,
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

  completeStreaming: () => {
    const { chatStreamingContent } = get();

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
      }));
    } else {
      set({
        chatStreaming: false,
        chatStreamingContent: "",
      });
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
          fetchChatSessions(name)
            .then((r) => ({ name, sessions: r.sessions.slice(0, SIDEBAR_SESSION_LIMIT) }))
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

  clearActiveChatState: () => {
    set({
      chatSessions: [],
      chatSessionsLoading: false,
      chatMessages: [],
      chatMessagesLoading: false,
      activeChatSessionId: null,
      chatStreaming: false,
      chatStreamingContent: "",
      chatError: null,
      // sidebarSessions intentionally preserved
    });
  },

  clearChatState: () => {
    set(initialChatState);
  },
});
