/**
 * TriggerJobModal component
 *
 * Modal for manually triggering a job. Allows selecting an agent,
 * optionally selecting a schedule, and optionally providing a prompt override.
 */

import { useState, useEffect, useCallback } from "react";
import { X, Play, AlertCircle, CheckCircle } from "lucide-react";
import { useFleet } from "../../store";
import { triggerAgent } from "../../lib/api";
import { Spinner } from "../ui";
import type { ScheduleInfo } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface TriggerJobModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Pre-selected agent name (optional) */
  preSelectedAgent?: string;
  /** Pre-selected schedule name (optional) */
  preSelectedSchedule?: string;
}

// =============================================================================
// Component
// =============================================================================

export function TriggerJobModal({
  isOpen,
  onClose,
  preSelectedAgent,
  preSelectedSchedule,
}: TriggerJobModalProps) {
  const { agents } = useFleet();

  const [selectedAgent, setSelectedAgent] = useState(preSelectedAgent ?? "");
  const [selectedSchedule, setSelectedSchedule] = useState(preSelectedSchedule ?? "");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedAgent(preSelectedAgent ?? "");
      setSelectedSchedule(preSelectedSchedule ?? "");
      setPrompt("");
      setSubmitting(false);
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, preSelectedAgent, preSelectedSchedule]);

  // Get schedules for the selected agent (match by qualifiedName)
  const agentSchedules: ScheduleInfo[] =
    agents.find((a) => a.qualifiedName === selectedAgent)?.schedules ?? [];

  // Reset schedule when agent changes (unless pre-selected)
  const handleAgentChange = useCallback((agentName: string) => {
    setSelectedAgent(agentName);
    setSelectedSchedule("");
    setError(null);
  }, []);

  const handleSubmit = async () => {
    if (!selectedAgent) {
      setError("Please select an agent");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await triggerAgent(selectedAgent, {
        scheduleName: selectedSchedule || undefined,
        prompt: prompt.trim() || undefined,
      });

      setSuccess(true);
      // Close after brief success indication
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to trigger job";
      setError(message);
      setSubmitting(false);
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-herd-card border border-herd-border rounded-[10px] p-5 max-w-md w-full mx-4 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-herd-fg">Trigger Job</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-herd-hover rounded transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4 text-herd-muted" />
          </button>
        </div>

        {/* Success state */}
        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle className="w-8 h-8 text-herd-status-running" />
            <p className="text-sm text-herd-fg font-medium">Job triggered</p>
          </div>
        ) : (
          <>
            {/* Agent select */}
            <div className="mb-3">
              <label
                htmlFor="trigger-agent"
                className="block text-xs text-herd-muted font-medium uppercase tracking-wide mb-1"
              >
                Agent
              </label>
              <select
                id="trigger-agent"
                value={selectedAgent}
                onChange={(e) => handleAgentChange(e.target.value)}
                className="bg-herd-input-bg border border-herd-border rounded-lg px-3 py-2 text-sm text-herd-fg focus:outline-none focus:border-herd-primary/60 transition-colors w-full"
                disabled={submitting}
              >
                <option value="">Select an agent...</option>
                {agents.map((agent) => (
                  <option key={agent.qualifiedName} value={agent.qualifiedName}>
                    {agent.qualifiedName}
                  </option>
                ))}
              </select>
            </div>

            {/* Schedule select (only if agent has schedules) */}
            {selectedAgent && agentSchedules.length > 0 && (
              <div className="mb-3">
                <label
                  htmlFor="trigger-schedule"
                  className="block text-xs text-herd-muted font-medium uppercase tracking-wide mb-1"
                >
                  Schedule (optional)
                </label>
                <select
                  id="trigger-schedule"
                  value={selectedSchedule}
                  onChange={(e) => setSelectedSchedule(e.target.value)}
                  className="bg-herd-input-bg border border-herd-border rounded-lg px-3 py-2 text-sm text-herd-fg focus:outline-none focus:border-herd-primary/60 transition-colors w-full"
                  disabled={submitting}
                >
                  <option value="">Default (first schedule)</option>
                  {agentSchedules.map((schedule) => (
                    <option key={schedule.name} value={schedule.name}>
                      {schedule.name} ({schedule.type})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Prompt textarea */}
            <div className="mb-4">
              <label
                htmlFor="trigger-prompt"
                className="block text-xs text-herd-muted font-medium uppercase tracking-wide mb-1"
              >
                Prompt (optional)
              </label>
              <textarea
                id="trigger-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Override the default prompt..."
                rows={3}
                className="bg-herd-input-bg border border-herd-border rounded-lg px-3 py-2 text-sm text-herd-fg placeholder:text-herd-muted focus:outline-none focus:border-herd-primary/60 transition-colors w-full resize-none"
                disabled={submitting}
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-3 py-2 text-xs mb-4 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={submitting}
                className="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !selectedAgent}
                className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <Spinner size="sm" />
                    Triggering...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Trigger
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
