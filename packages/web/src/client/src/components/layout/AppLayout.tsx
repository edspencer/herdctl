/**
 * Three-panel layout shell for @herdctl/web
 *
 * Uses react-resizable-panels for the layout:
 * - Left sidebar: agent list and navigation (~250px, collapsible)
 * - Main content: routed page content (flexible)
 * - Right detail panel: contextual details (~280px, toggleable)
 */

import type { ReactNode } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { useUI, useStore } from "../../store";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { ConnectionBanner } from "../ui";

// =============================================================================
// Types
// =============================================================================

interface AppLayoutProps {
  children: ReactNode;
}

// =============================================================================
// Component
// =============================================================================

export function AppLayout({ children }: AppLayoutProps) {
  const { rightPanelOpen, sidebarCollapsed } = useUI();
  const connectionStatus = useStore((state) => state.connectionStatus);

  return (
    <div className="h-dvh bg-herd-bg overflow-hidden">
      <PanelGroup direction="horizontal" className="h-full">
        {/* Left sidebar panel */}
        {!sidebarCollapsed && (
          <>
            <Panel
              id="sidebar"
              order={1}
              defaultSize={20}
              minSize={15}
              maxSize={30}
              className="bg-herd-sidebar"
            >
              <Sidebar />
            </Panel>
            <PanelResizeHandle className="w-px bg-herd-border hover:bg-herd-primary/30 transition-colors" />
          </>
        )}

        {/* Main content panel */}
        <Panel id="main" order={2} minSize={40} className="flex flex-col min-w-0">
          <Header />
          <ConnectionBanner status={connectionStatus} />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </Panel>

        {/* Right detail panel (toggleable) */}
        {rightPanelOpen && (
          <>
            <PanelResizeHandle className="w-px bg-herd-border hover:bg-herd-primary/30 transition-colors" />
            <Panel
              id="detail"
              order={3}
              defaultSize={22}
              minSize={18}
              maxSize={35}
              className="bg-herd-card border-l border-herd-border"
            >
              <div className="p-4">
                <p className="text-xs text-herd-muted">
                  Detail panel — Coming in Phase 3
                </p>
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
