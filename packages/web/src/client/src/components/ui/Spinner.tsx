/**
 * Spinner component
 *
 * A simple loading spinner with configurable size.
 * Uses the primary accent color from the design system.
 */

// =============================================================================
// Types
// =============================================================================

interface SpinnerProps {
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  const sizeClasses = {
    sm: "w-4 h-4 border-2",
    md: "w-6 h-6 border-2",
    lg: "w-8 h-8 border-[3px]",
  };

  return (
    <output
      className={`inline-block rounded-full border-herd-primary border-t-transparent animate-spin ${sizeClasses[size]} ${className}`}
      aria-label="Loading"
    />
  );
}
