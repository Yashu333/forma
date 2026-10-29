"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

/** Empty-state create: a button that turns into a name field, then opens the new board. */
export default function NewProjectButton() {
  const [creating, setCreating] = useState(false);
  const [name, setName]         = useState("");
  const [saving, setSaving]     = useState(false);
  const router = useRouter();

  async function create(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const group = await res.json();
      window.dispatchEvent(new CustomEvent("group-created", { detail: group }));
      router.push(`/group/${group.id}`);
    } else {
      setSaving(false);
    }
  }

  if (!creating) {
    return (
      <button type="button" onClick={() => setCreating(true)} className="btn-primary mt-6">
        <Plus className="w-4 h-4" aria-hidden="true" />
        New project
      </button>
    );
  }

  return (
    <form onSubmit={create} className="mt-6 flex w-full max-w-xs gap-2">
      <input
        autoFocus value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setCreating(false); setName(""); } }}
        placeholder="Project name…"
        aria-label="Project name"
        className="forma-input flex-1 min-w-0"
      />
      <button type="submit" disabled={!name.trim() || saving} className="btn-primary">
        Create
      </button>
    </form>
  );
}
