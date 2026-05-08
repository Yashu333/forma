"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Group } from "@/types";
import { Plus, LayoutGrid, LogOut, ChevronRight, Pencil, Check, Timer, Menu, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props { userId: string; userEmail: string; }

function nameKey(userId: string) { return `forma_display_name_${userId}`; }

function useStoredName(userId: string, fallback: string): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => localStorage.getItem(nameKey(userId)) ?? fallback,
    () => fallback,
  );
}

export default function Sidebar({ userId, userEmail }: Props) {
  const defaultName = userEmail.split("@")[0];
  const storedName  = useStoredName(userId, defaultName);

  const [groups, setGroups]                 = useState<Group[]>([]);
  const [creating, setCreating]             = useState(false);
  const [newName, setNewName]               = useState("");
  const [editingName, setEditingName]       = useState(false);
  const [nameInput, setNameInput]           = useState(storedName);
  const [open, setOpen]                     = useState(false);
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  useEffect(() => {
    fetch("/api/groups").then(r => r.ok ? r.json() : []).then(setGroups);
  }, []);

  useEffect(() => {
    function onGroupDeleted(e: Event) {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      setGroups(prev => prev.filter(g => g.id !== id));
    }
    window.addEventListener("group-deleted", onGroupDeleted);
    return () => window.removeEventListener("group-deleted", onGroupDeleted);
  }, []);

  // Close sidebar overlay when navigating on mobile
  useEffect(() => { setOpen(false); }, [pathname]);

  function saveName() {
    const trimmed = nameInput.trim();
    const next = trimmed || defaultName;
    localStorage.setItem(nameKey(userId), next);
    window.dispatchEvent(new StorageEvent("storage", { key: nameKey(userId), newValue: next }));
    setNameInput(next);
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

  const initials = storedName.slice(0, 2).toUpperCase();

  return (
    <>
      {/* Mobile/tablet hamburger button */}
      <button
        className="lg:hidden fixed top-3.5 left-3.5 z-50 w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150"
        style={{ background: open ? "var(--elevated)" : "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        onClick={() => setOpen(v => !v)}
        aria-label="Toggle sidebar"
      >
        {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
      </button>

      {/* Overlay backdrop on mobile/tablet */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-30"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setOpen(false)}
        />
      )}

    <aside
      className={[
        "flex flex-col h-full z-40 transition-transform duration-300 ease-in-out",
        // Desktop: always visible, static in flow
        "lg:static lg:translate-x-0 lg:w-56 lg:flex-shrink-0",
        // Mobile/tablet: fixed overlay, slides in/out via transform (not display) so animation works
        "max-lg:fixed max-lg:top-0 max-lg:left-0 max-lg:bottom-0 max-lg:w-72",
        open ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
      ].join(" ")}
      style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}
    >

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
          <span className="text-[15px] font-black tracking-widest uppercase select-none"
                style={{ color: "#F97316" }}>
            FORMA
          </span>
        </div>
      </div>

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
                      style={{ color: pathname === "/dashboard" ? "var(--text-primary)" : "var(--text-muted)" }} />
          Dashboard
        </Link>

        <Link
          href="/pomodoro"
          target="_blank"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 w-full text-left"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
          }}
        >
          <Timer className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
          Pomodoro
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
            <div key={group.id} className="group/project relative flex items-center rounded-lg transition-all duration-150"
              style={{
                background: active ? "var(--accent-subtle)" : undefined,
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = ""; }}
            >
              <Link href={`/group/${group.id}`}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm flex-1 min-w-0 transition-colors duration-150"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: active ? 500 : undefined,
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: group.color, boxShadow: active ? `0 0 7px 1px ${group.color}66` : "none" }} />
                <span className="truncate flex-1">{group.name}</span>
                {active && <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: "var(--text-disabled)" }} />}
              </Link>
            </div>
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

      <div className="px-2.5 py-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors group"
             onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"}
             onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}>

          <div className="w-8 h-8 rounded-lg text-[12px] font-bold flex items-center justify-center flex-shrink-0 select-none"
               suppressHydrationWarning
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
                  onKeyDown={e => { if (e.key === "Escape") { setNameInput(storedName); setEditingName(false); } }}
                  className="text-xs font-medium w-full outline-none rounded px-1 py-0.5"
                  style={{ background: "var(--elevated)", color: "var(--text-primary)", border: "1px solid var(--accent-border)" }}
                />
                <button type="submit" className="flex-shrink-0" style={{ color: "var(--accent)" }}>
                  <Check className="w-3 h-3" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => { setNameInput(storedName); setEditingName(true); }}
                className="flex items-center gap-1 group/name text-left w-full"
              >
                <span className="text-xs font-semibold truncate" suppressHydrationWarning
                      style={{ color: "var(--text-primary)" }}>
                  {storedName}
                </span>
                <Pencil className="w-2.5 h-2.5 flex-shrink-0 opacity-0 group-hover/name:opacity-60 transition-opacity"
                        style={{ color: "var(--text-muted)" }} />
              </button>
            )}
            <span className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
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
    </>
  );
}
