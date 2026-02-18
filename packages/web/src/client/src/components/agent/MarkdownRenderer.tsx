/**
 * MarkdownRenderer component
 *
 * Renders markdown content with custom styling that follows the design system.
 * Uses react-markdown with remark-gfm for GitHub Flavored Markdown support.
 */

import { useState, useCallback, type ReactNode, type ComponentPropsWithoutRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface MarkdownRendererProps {
  /** Markdown content to render */
  content: string;
  /** Use serif font for body text (for assistant responses) */
  useSerif?: boolean;
}

// =============================================================================
// Copy Button Component
// =============================================================================

interface CopyButtonProps {
  text: string;
}

function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API failed, ignore
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1 rounded-md bg-herd-hover hover:bg-herd-active text-herd-code-fg/60 hover:text-herd-code-fg transition-colors"
      title="Copy code"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// =============================================================================
// Custom Components for Markdown
// =============================================================================

/**
 * Code block renderer with copy button
 */
function CodeBlock({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const codeText = String(children).replace(/\n$/, "");

  return (
    <div className="relative my-3">
      <pre className="bg-herd-code-bg text-herd-code-fg rounded-lg p-3 text-xs font-mono overflow-x-auto">
        <code className={className}>{codeText}</code>
      </pre>
      <CopyButton text={codeText} />
    </div>
  );
}

/**
 * Inline code renderer
 */
function InlineCode({ children }: { children?: ReactNode }) {
  return (
    <code className="bg-herd-hover px-1.5 py-0.5 rounded text-xs font-mono text-herd-fg">
      {children}
    </code>
  );
}

// =============================================================================
// Component
// =============================================================================

export function MarkdownRenderer({ content, useSerif = false }: MarkdownRendererProps) {
  // Custom components for react-markdown
  const components = {
    // Code blocks vs inline code
    code(props: ComponentPropsWithoutRef<"code">) {
      const { className, children } = props;
      // Check if this is a code block (has language class) or inline code
      // react-markdown wraps code blocks in <pre><code> but inline in just <code>
      const isBlock = className?.startsWith("language-");

      if (isBlock) {
        return <CodeBlock className={className}>{children}</CodeBlock>;
      }

      return <InlineCode>{children}</InlineCode>;
    },

    // Pre tag - just pass through, code block styling handled by code component
    pre({ children }: ComponentPropsWithoutRef<"pre">) {
      // Extract the code element from children
      return <>{children}</>;
    },

    // Links
    a({ href, children }: ComponentPropsWithoutRef<"a">) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-herd-primary hover:underline"
        >
          {children}
        </a>
      );
    },

    // Headers (capped at text-lg per design system)
    h1({ children }: ComponentPropsWithoutRef<"h1">) {
      return (
        <h1 className="text-lg font-semibold text-herd-fg mt-4 mb-2">{children}</h1>
      );
    },
    h2({ children }: ComponentPropsWithoutRef<"h2">) {
      return (
        <h2 className="text-sm font-semibold text-herd-fg mt-3 mb-2">{children}</h2>
      );
    },
    h3({ children }: ComponentPropsWithoutRef<"h3">) {
      return (
        <h3 className="text-sm font-medium text-herd-fg mt-3 mb-1">{children}</h3>
      );
    },
    h4({ children }: ComponentPropsWithoutRef<"h4">) {
      return (
        <h4 className="text-sm font-medium text-herd-muted mt-2 mb-1">{children}</h4>
      );
    },

    // Paragraphs
    p({ children }: ComponentPropsWithoutRef<"p">) {
      return <p className="text-sm text-herd-fg mb-2 last:mb-0">{children}</p>;
    },

    // Lists
    ul({ children }: ComponentPropsWithoutRef<"ul">) {
      return <ul className="list-disc list-inside text-sm text-herd-fg mb-2 ml-2">{children}</ul>;
    },
    ol({ children }: ComponentPropsWithoutRef<"ol">) {
      return <ol className="list-decimal list-inside text-sm text-herd-fg mb-2 ml-2">{children}</ol>;
    },
    li({ children }: ComponentPropsWithoutRef<"li">) {
      return <li className="mb-0.5">{children}</li>;
    },

    // Tables (design system table pattern)
    table({ children }: ComponentPropsWithoutRef<"table">) {
      return (
        <div className="overflow-x-auto my-3">
          <table className="w-full text-sm">{children}</table>
        </div>
      );
    },
    thead({ children }: ComponentPropsWithoutRef<"thead">) {
      return <thead>{children}</thead>;
    },
    tbody({ children }: ComponentPropsWithoutRef<"tbody">) {
      return <tbody className="divide-y divide-herd-border">{children}</tbody>;
    },
    tr({ children }: ComponentPropsWithoutRef<"tr">) {
      return (
        <tr className="border-b border-herd-border hover:bg-herd-hover transition-colors">
          {children}
        </tr>
      );
    },
    th({ children }: ComponentPropsWithoutRef<"th">) {
      return (
        <th className="text-left py-2 px-3 text-xs text-herd-muted font-medium uppercase tracking-wide">
          {children}
        </th>
      );
    },
    td({ children }: ComponentPropsWithoutRef<"td">) {
      return <td className="py-2 px-3 text-herd-fg">{children}</td>;
    },

    // Blockquotes
    blockquote({ children }: ComponentPropsWithoutRef<"blockquote">) {
      return (
        <blockquote className="border-l-2 border-herd-primary pl-3 my-2 text-sm text-herd-muted italic">
          {children}
        </blockquote>
      );
    },

    // Horizontal rule
    hr() {
      return <hr className="border-herd-border my-4" />;
    },

    // Strong and emphasis
    strong({ children }: ComponentPropsWithoutRef<"strong">) {
      return <strong className="font-semibold">{children}</strong>;
    },
    em({ children }: ComponentPropsWithoutRef<"em">) {
      return <em className="italic">{children}</em>;
    },
  };

  return (
    <div className={useSerif ? "font-serif" : "font-sans"}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  );
}
