/**
 * AllChatsPage component
 *
 * Main page for browsing all Claude Code sessions on the machine.
 * Displays sessions grouped by working directory with search and filtering.
 */

import { FolderSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { sessionMatchesQuery } from "../../lib/session-utils";
import type { DirectoryGroup as DirectoryGroupType } from "../../lib/types";
import {
  useAllChatsActions,
  useAllChatsError,
  useAllChatsExpandedGroups,
  useAllChatsGroups,
  useAllChatsLoading,
  useAllChatsSearchQuery,
  useAllChatsTotalGroups,
} from "../../store";
import { AllChatsSearch } from "./AllChatsSearch";
import { DirectoryGroup } from "./DirectoryGroup";

/**
 * Check if a directory group matches the search query.
 * A group matches if the working directory, agent name, or any session matches.
 */
function groupMatchesQuery(group: DirectoryGroupType, query: string): boolean {
  const lowerQuery = query.toLowerCase();

  // Check working directory
  if (group.workingDirectory.toLowerCase().includes(lowerQuery)) return true;

  // Check agent name
  if (group.agentName?.toLowerCase().includes(lowerQuery)) return true;

  // Check sessions
  return group.sessions.some((session) => sessionMatchesQuery(session, query));
}

// =============================================================================
// Sub-Components
// =============================================================================

function LoadingState() {
  return (
    <div className="space-y-4">
      {/* Skeleton for search */}
      <div className="h-10 bg-herd-hover rounded-lg animate-pulse" />

      {/* Skeleton groups */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="border border-herd-border rounded-[10px] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-herd-hover rounded animate-pulse" />
            <div className="flex-1 h-4 bg-herd-hover rounded animate-pulse" />
            <div className="w-20 h-4 bg-herd-hover rounded animate-pulse" />
          </div>
          <div className="space-y-2 pl-6">
            <div className="h-8 bg-herd-hover rounded animate-pulse" />
            <div className="h-8 bg-herd-hover rounded animate-pulse" />
            <div className="h-8 bg-herd-hover rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-4 py-3 text-sm flex items-center justify-between">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="hover:underline font-medium ml-4">
        Retry
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <FolderSearch className="w-12 h-12 text-herd-muted" />
      <div>
        <p className="text-sm text-herd-fg font-medium">No Claude Code sessions found</p>
        <p className="text-xs text-herd-muted mt-1">
          Sessions will appear here as you use Claude Code in different projects
        </p>
      </div>
    </div>
  );
}

function NoSearchResults() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <FolderSearch className="w-12 h-12 text-herd-muted" />
      <div>
        <p className="text-sm text-herd-fg font-medium">No matching sessions</p>
        <p className="text-xs text-herd-muted mt-1">Try adjusting your search query</p>
      </div>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function AllChatsPage() {
  // Store state
  const groups = useAllChatsGroups();
  const totalGroups = useAllChatsTotalGroups();
  const loading = useAllChatsLoading();
  const error = useAllChatsError();
  const storeSearchQuery = useAllChatsSearchQuery();
  const expandedGroups = useAllChatsExpandedGroups();
  const { fetchAllChats, setAllChatsSearchQuery, toggleAllChatsGroup, expandAllChatsGroups } =
    useAllChatsActions();

  // Local state for debounced search
  const [localSearchValue, setLocalSearchValue] = useState(storeSearchQuery);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store pre-search expansion state
  const preSearchExpansionRef = useRef<Set<string> | null>(null);

  // Fetch data on mount
  useEffect(() => {
    fetchAllChats();
  }, [fetchAllChats]);

  // Debounce search query updates to store
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setAllChatsSearchQuery(localSearchValue);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [localSearchValue, setAllChatsSearchQuery]);

  // Auto-expand groups when searching, restore when clearing
  // biome-ignore lint/correctness/useExhaustiveDependencies: expandedGroups is read but must not trigger this effect (causes infinite loop)
  useEffect(() => {
    if (storeSearchQuery) {
      // Starting a search - save current expansion state
      if (!preSearchExpansionRef.current) {
        preSearchExpansionRef.current = new Set(expandedGroups);
      }
      // Expand all groups during search
      expandAllChatsGroups();
    } else {
      // Clearing search - expansion state is already managed by store
      preSearchExpansionRef.current = null;
    }
  }, [storeSearchQuery, expandAllChatsGroups]);

  // Filter groups based on search query
  const filteredGroups = useMemo(() => {
    if (!storeSearchQuery) return groups;
    return groups.filter((group) => groupMatchesQuery(group, storeSearchQuery));
  }, [groups, storeSearchQuery]);

  // Handle search input change
  const handleSearchChange = (value: string) => {
    setLocalSearchValue(value);
  };

  // Handle toggle for a group
  const handleToggleGroup = (encodedPath: string) => {
    toggleAllChatsGroup(encodedPath);
  };

  // Handle retry
  const handleRetry = () => {
    fetchAllChats();
  };

  // Handle load more groups
  const handleLoadMore = () => {
    fetchAllChats({ limit: groups.length + 20 });
  };

  // Determine content to render
  const renderContent = () => {
    // Show loading on initial load
    if (loading && groups.length === 0) {
      return <LoadingState />;
    }

    // Show error state
    if (error) {
      return <ErrorState message={error} onRetry={handleRetry} />;
    }

    // Show empty state if no groups at all
    if (groups.length === 0) {
      return <EmptyState />;
    }

    // Show no search results
    if (storeSearchQuery && filteredGroups.length === 0) {
      return <NoSearchResults />;
    }

    // Render the directory groups
    return (
      <div className="space-y-4">
        {filteredGroups.map((group) => (
          <DirectoryGroup
            key={group.encodedPath}
            group={group}
            expanded={expandedGroups.has(group.encodedPath)}
            onToggle={() => handleToggleGroup(group.encodedPath)}
            searchQuery={storeSearchQuery}
          />
        ))}

        {/* Load more button */}
        {totalGroups > groups.length && !storeSearchQuery && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loading}
              className="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Loading..." : `Load more (${totalGroups - groups.length} remaining)`}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-herd-fg">All Chats</h1>
          <p className="text-sm text-herd-muted mt-1">Every Claude Code session on this machine</p>
        </div>

        {/* Search bar */}
        <div className="mb-6">
          <AllChatsSearch value={localSearchValue} onChange={handleSearchChange} />
        </div>

        {/* Main content */}
        {renderContent()}
      </div>
    </div>
  );
}
