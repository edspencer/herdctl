/**
 * Card component
 *
 * A reusable card wrapper with consistent styling.
 * Follows the design system's card pattern.
 */

import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

// =============================================================================
// Types
// =============================================================================

type CardElement = "div" | "article";

type CardOwnProps<E extends CardElement = "div"> = {
  /** Card content */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Click handler - makes the card interactive */
  onClick?: () => void;
  /** HTML element to render as */
  as?: E;
};

type CardProps<E extends CardElement = "div"> = CardOwnProps<E> &
  Omit<ComponentPropsWithoutRef<E>, keyof CardOwnProps<E>>;

// =============================================================================
// Component
// =============================================================================

export function Card<E extends CardElement = "div">({
  children,
  className = "",
  onClick,
  as,
  ...props
}: CardProps<E>) {
  const Component = (as ?? "div") as ElementType;

  const baseClasses = "bg-herd-card border border-herd-border rounded-[10px]";
  const interactiveClasses = onClick
    ? "cursor-pointer hover:border-herd-primary/30 transition-colors"
    : "";

  return (
    <Component
      className={`${baseClasses} ${interactiveClasses} ${className}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </Component>
  );
}
