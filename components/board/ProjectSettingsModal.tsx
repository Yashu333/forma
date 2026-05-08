"use client";

import { useState, useEffect, useRef } from "react";
import { X, Trash2 } from "lucide-react";

interface Props {
  groupId: string;
  groupName: string;
  onClose: () => void;
  onDeleted: () => void;
}

export default function ProjectSettingsModal({ groupId, groupName, onClose, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="w-96 rounded-2xl flex flex-col animate-in-up overflow-hidden"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
             style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Project settings
          </p>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = ""; }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Name</p>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{groupName}</p>
          </div>
        </div>

        {/* Danger zone */}
        <div className="px-5 py-4 flex flex-col gap-3"
             style={{ borderTop: "1px solid rgba(239,68,68,0.18)", background: "rgba(239,68,68,0.04)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#EF4444", opacity: 0.7 }}>
            Danger zone
          </p>

          {!confirming ? (
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>Delete this project</p>
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  Permanently removes all columns and tasks.
                </p>
              </div>
              <button
                onClick={() => setConfirming(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-100 flex-shrink-0 ml-4"
                style={{
                  background: "rgba(239,68,68,0.12)",
                  border: "1px solid rgba(239,68,68,0.30)",
                  color: "#EF4444",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.22)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.12)"; }}
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Are you sure? <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>"{groupName}"</span> and all its columns and tasks will be permanently deleted.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-100"
                  style={{
                    background: "var(--elevated)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text-secondary)",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-100"
                  style={{
                    background: "rgba(239,68,68,0.18)",
                    border: "1px solid rgba(239,68,68,0.40)",
                    color: "#EF4444",
                    opacity: deleting ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!deleting) (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.28)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.18)"; }}
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
