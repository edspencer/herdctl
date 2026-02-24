/**
 * AllChatsSearch component
 *
 * A search input for filtering sessions in the All Chats page.
 * Uses monospace font since paths are common search terms.
 */

import { Search, X } from "lucide-react";
import { useCallback, useRef } from "react";

// =============================================================================
// Types
// =============================================================================

interface AllChatsSearchProps {
  /** Current search value */
  value: string;
  /** Called when the search value changes */
  onChange: (value: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export function AllChatsSearch({ value, onChange }: AllChatsSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  return (
    <div className="relative w-full">
      {/* Search icon */}
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-herd-muted pointer-events-none" />

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search sessions..."
        className="w-full bg-herd-input-bg border border-herd-border rounded-lg pl-10 pr-10 py-2 text-sm font-mono text-herd-fg placeholder:text-herd-muted focus:outline-none focus:border-herd-primary/60 transition-colors"
      />

      {/* Clear button - only visible when there's text */}
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-herd-hover transition-colors"
          title="Clear search"
        >
          <X className="w-4 h-4 text-herd-muted hover:text-herd-fg" />
        </button>
      )}
    </div>
  );
}
