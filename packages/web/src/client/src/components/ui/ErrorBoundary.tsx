/**
 * ErrorBoundary component
 *
 * Catches React render errors and displays a friendly error card.
 * Supports optional custom fallback UI via the `fallback` prop.
 */

import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface ErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Optional custom fallback UI rendered when an error occurs */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean;
  /** The caught error */
  error: Error | null;
}

// =============================================================================
// Component
// =============================================================================

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error for debugging — intentional use of console.error for dev tooling
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error card
      return (
        <div className="flex items-center justify-center p-6">
          <div className="bg-herd-card border border-herd-border rounded-[10px] p-6 max-w-md w-full text-center">
            <AlertTriangle className="w-12 h-12 text-herd-status-error mx-auto mb-3" />
            <h2 className="text-sm font-medium text-herd-fg mb-2">Something went wrong</h2>
            {this.state.error && (
              <div className="bg-herd-code-bg text-herd-code-fg rounded-lg px-3 py-2 text-xs font-mono text-left mb-4 overflow-x-auto">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
