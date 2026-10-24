"use client";

import { useState, useEffect, useRef } from "react";
import { X, Trash2, BarChart3 } from "lucide-react";

interface Props {
  groupId: string;
  groupName: string;
  excludeFromReports?: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export default function ProjectSettingsModal({ groupId, groupName, excludeFromReports: initialExcluded, onClose, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [excluded, setExcluded] = useState(!!initialExcluded);
  const [savingExcluded, setSavingExcluded] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  async function toggleExcluded() {
    const next = !excluded;
    setExcluded(next);
    setSavingExcluded(true);
    const res = await fetch(`/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excludeFromReports: next }),
    });
    if (!res.ok) setExcluded(!next);
    setSavingExcluded(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
    onDeleted();
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Project settings"
        className="w-96 max-w-full rounded-lg flex flex-col animate-in-up overflow-hidden border border-border-strong bg-surface"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Project settings</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-md text-subtle transition-colors hover:bg-raised hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">Name</p>
            <p className="text-sm font-medium text-foreground">{groupName}</p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-2.5 min-w-0">
              <BarChart3 className="w-4 h-4 flex-shrink-0 mt-0.5 text-subtle" aria-hidden="true" />
              <div className="flex flex-col gap-0.5 min-w-0">
                <p id="exclude-label" className="text-xs font-medium text-foreground">Exclude from reports</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Hides this project&rsquo;s tasks from Reports entirely: throughput, cycle time and breakdowns.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleExcluded}
              disabled={savingExcluded}
              role="switch"
              aria-checked={excluded}
              aria-labelledby="exclude-label"
              className={`flex-shrink-0 relative w-9 h-5 rounded-full border transition-colors duration-150 disabled:opacity-60 ${
                excluded ? "bg-primary border-primary" : "bg-raised border-input"
              }`}
            >
              <span
                className={`absolute top-[2px] w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                  excluded ? "left-[18px] bg-primary-foreground" : "left-[2px] bg-muted-foreground"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Danger zone */}
        <div className="px-5 py-4 flex flex-col gap-3 border-t border-border">
          <p className="text-[13px] font-semibold text-danger">Delete project</p>

          {!confirming ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Permanently removes all columns and tasks.
              </p>
              <button
                onClick={() => setConfirming(true)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium flex-shrink-0 border border-danger text-danger bg-surface transition-colors hover:bg-raised"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
                Delete
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Are you sure? <span className="font-medium text-foreground">&ldquo;{groupName}&rdquo;</span> and all its columns and tasks will be permanently deleted.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="h-8 px-3.5 rounded-md text-xs font-medium border border-border bg-raised text-foreground transition-colors hover:bg-border"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="h-8 px-3.5 rounded-md text-xs font-semibold border border-danger text-danger bg-surface transition-colors hover:bg-raised disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete project"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
