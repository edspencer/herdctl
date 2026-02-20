/**
 * Three-panel layout shell for @herdctl/web
 *
 * Uses react-resizable-panels for the layout:
 * - Left sidebar: agent list and navigation (~250px, collapsible)
 * - Main content: routed page content (flexible)
 * - Right detail panel: contextual details (~280px, toggleable)
 */

import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useStore, useUI, useUIActions } from "../../store";
import { ConnectionStatus } from "../ui";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

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
  const { rightPanelOpen, sidebarCollapsed, sidebarMobileOpen } = useUI();
  const { setSidebarMobileOpen } = useUIActions();
  const connectionStatus = useStore((state) => state.connectionStatus);

  return (
    <div className="h-dvh bg-herd-bg overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarMobileOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          {/* Backdrop */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal via click */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSidebarMobileOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSidebarMobileOpen(false);
            }}
          />
          {/* Sidebar drawer */}
          <div className="absolute inset-y-0 left-0 w-[260px] bg-herd-sidebar border-r border-herd-sidebar-border animate-fade-slide-in">
            <Sidebar onNavigate={() => setSidebarMobileOpen(false)} />
          </div>
        </div>
      )}

      <PanelGroup direction="horizontal" className="h-full">
        {/* Left sidebar panel — hidden on mobile, shown on md+ */}
        {!sidebarCollapsed && (
          <>
            <Panel
              id="sidebar"
              order={1}
              defaultSize={20}
              minSize={15}
              maxSize={30}
              className="bg-herd-sidebar hidden md:block"
            >
              <Sidebar />
            </Panel>
            <PanelResizeHandle className="w-px bg-herd-border hover:bg-herd-primary/30 transition-colors hidden md:block" />
          </>
        )}

        {/* Main content panel */}
        <Panel id="main" order={2} minSize={40} className="flex flex-col min-w-0">
          <Header />
          <ConnectionStatus status={connectionStatus} />
          <main className="flex-1 overflow-auto">{children}</main>
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
                <p className="text-xs text-herd-muted">Detail panel — Coming in Phase 3</p>
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
