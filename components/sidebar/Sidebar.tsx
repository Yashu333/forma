"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Group } from "@/types";
import { Plus, LayoutGrid, LogOut, ChevronRight, Pencil, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props { userId: string; userEmail: string; }

// Key scoped per userId so each account has its own display name
function nameKey(userId: string) { return `forma_display_name_${userId}`; }

function getStoredName(userId: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(nameKey(userId)) || fallback;
}

export default function Sidebar({ userId, userEmail }: Props) {
  const defaultName = userEmail.split("@")[0];
  const [groups, setGroups]           = useState<Group[]>([]);
  const [creating, setCreating]       = useState(false);
  const [newName, setNewName]         = useState("");
  const [editingName, setEditingName] = useState(false);
  // Always start with defaultName so server and client render the same HTML.
  // After mount, overwrite from localStorage if a custom name exists.
  const [displayName, setDisplayName] = useState(defaultName);
  const [nameInput, setNameInput]     = useState(defaultName);
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const stored = getStoredName(userId, defaultName);
    if (stored !== defaultName) {
      setDisplayName(stored);
      setNameInput(stored);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    fetch("/api/groups").then(r => r.ok ? r.json() : []).then(setGroups);
  }, []);

  function saveName() {
    const trimmed = nameInput.trim();
    const next = trimmed || defaultName;
    setDisplayName(next);
    setNameInput(next);
    localStorage.setItem(nameKey(userId), next);
    // Broadcast so dashboard can react
    window.dispatchEvent(new StorageEvent("storage", { key: nameKey(userId), newValue: next }));
    setEditingName(false);
  }

  async function createGroup(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const group: Group = await res.json();
      setGroups(p => [...p, group]);
      setNewName(""); setCreating(false);
      router.push(`/group/${group.id}`);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  // Initials from display name, not email
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col h-full"
           style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}>

      {/* ── Logo — no color inheritance from parent, brand-text is self-contained ── */}
      <div className="px-4 h-14 flex items-center">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
               style={{ background: "linear-gradient(135deg,rgba(249,115,22,0.22),rgba(251,146,60,0.12))", border: "1px solid rgba(249,115,22,0.30)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#F97316"/>
              <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#FB923C" opacity="0.7"/>
              <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#FB923C" opacity="0.7"/>
              <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#FBBF24" opacity="0.4"/>
            </svg>
          </div>
          {/* SVG text — completely immune to CSS color inheritance */}
          <svg width="72" height="18" viewBox="0 0 72 18" aria-label="FORMA">
            <defs>
              <linearGradient id="brand-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#F97316"/>
                <stop offset="55%"  stopColor="#FB923C"/>
                <stop offset="100%" stopColor="#FBBF24"/>
              </linearGradient>
            </defs>
            <text x="0" y="14" fill="url(#brand-grad)"
              fontFamily="inherit" fontSize="15" fontWeight="900"
              letterSpacing="3" textAnchor="start">FORMA</text>
          </svg>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5">

        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150"
          style={{
            color: pathname === "/dashboard" ? "var(--text-primary)" : "var(--text-muted)",
            background: pathname === "/dashboard" ? "var(--accent-subtle)" : undefined,
          }}
          onMouseEnter={e => {
            if (pathname !== "/dashboard") {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
              (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
            }
          }}
          onMouseLeave={e => {
            if (pathname !== "/dashboard") {
              (e.currentTarget as HTMLElement).style.background = "";
              (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
            }
          }}
        >
          <LayoutGrid className="w-4 h-4 flex-shrink-0"
                      style={{ color: pathname === "/dashboard" ? "var(--accent)" : "var(--text-muted)" }} />
          Dashboard
        </Link>

        <div className="pt-5 pb-2 px-2.5">
          <span className="section-label">Projects</span>
        </div>

        {creating && (
          <form onSubmit={createGroup} className="px-0.5 pb-1 animate-in-up">
            <input
              autoFocus value={newName}
              onChange={e => setNewName(e.target.value)}
              onBlur={() => { if (!newName.trim()) setCreating(false); }}
              onKeyDown={e => e.key === "Escape" && setCreating(false)}
              placeholder="Project name…"
              className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
              style={{ background: "var(--elevated)", border: "1px solid var(--accent-border)", color: "var(--text-primary)" }}
            />
          </form>
        )}

        {groups.map(group => {
          const active = pathname === `/group/${group.id}`;
          return (
            <Link key={group.id} href={`/group/${group.id}`}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150"
              style={{
                color: active ? "var(--text-primary)" : "var(--text-muted)",
                background: active ? "var(--accent-subtle)" : undefined,
                fontWeight: active ? 500 : undefined,
              }}
              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; } }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; } }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: group.color, boxShadow: active ? `0 0 7px 1px ${group.color}66` : "none" }} />
              <span className="truncate flex-1">{group.name}</span>
              {active && <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: "var(--text-disabled)" }} />}
            </Link>
          );
        })}

        <button
          onClick={() => { setCreating(true); setNewName(""); }}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm mt-1 transition-all duration-150"
          style={{ color: "var(--text-secondary)", border: "1px dashed var(--border-strong)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
        >
          <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
               style={{ background: "rgba(255,255,255,0.10)", border: "1px solid var(--border-strong)" }}>
            <Plus className="w-2.5 h-2.5" />
          </div>
          New Project
        </button>
      </nav>

      {/* ── User footer ── */}
      <div className="px-2.5 py-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors group"
             onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"}
             onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}>

          {/* Avatar — solid bg so initials are always visible */}
          <div className="w-8 h-8 rounded-lg text-[12px] font-bold flex items-center justify-center flex-shrink-0 select-none"
               style={{ background: "var(--accent)", color: "#fff", letterSpacing: "0.05em" }}>
            {initials}
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            {editingName ? (
              <form onSubmit={e => { e.preventDefault(); saveName(); }} className="flex items-center gap-1">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={e => { if (e.key === "Escape") { setNameInput(displayName); setEditingName(false); } }}
                  className="text-xs font-medium w-full outline-none rounded px-1 py-0.5"
                  style={{ background: "var(--elevated)", color: "var(--text-primary)", border: "1px solid var(--accent-border)" }}
                />
                <button type="submit" className="flex-shrink-0" style={{ color: "var(--accent)" }}>
                  <Check className="w-3 h-3" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => { setNameInput(displayName); setEditingName(true); }}
                className="flex items-center gap-1 group/name text-left w-full"
              >
                <span className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                  {displayName}
                </span>
                <Pencil className="w-2.5 h-2.5 flex-shrink-0 opacity-0 group-hover/name:opacity-60 transition-opacity"
                        style={{ color: "var(--text-muted)" }} />
              </button>
            )}
            <span className="text-[10px] truncate" style={{ color: "var(--text-disabled)" }}>
              {userEmail}
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger onClick={signOut} className="btn-icon w-6 h-6 opacity-0 group-hover:opacity-100">
              <LogOut className="w-3.5 h-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
