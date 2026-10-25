"use client";

import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-80 max-w-full rounded-lg border border-border-strong bg-surface p-5 flex flex-col gap-4 animate-in-up"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-danger" aria-hidden="true" />
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{message}</p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="h-8 px-3.5 rounded-md text-xs font-medium border border-border bg-raised text-foreground transition-colors hover:bg-border hover:border-border-strong max-lg:h-10"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="h-8 px-3.5 rounded-md text-xs font-semibold border border-border text-danger bg-surface transition-colors hover:bg-raised hover:border-border-strong max-lg:h-10"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
