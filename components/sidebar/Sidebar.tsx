"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Group } from "@/types";
import { Plus, LayoutGrid, LogOut, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props { userId: string; userEmail: string; }

export default function Sidebar({ userId, userEmail }: Props) {
  const [groups, setGroups]     = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  useEffect(() => {
    fetch("/api/groups").then(r => r.ok ? r.json() : []).then(setGroups);
  }, []);

  async function createGroup(e: React.FormEvent) {
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

  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <aside style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}
           className="w-56 flex-shrink-0 flex flex-col h-full">

      {/* Logo */}
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
          <span className="text-[15px] font-black tracking-widest uppercase brand-text">FORMA</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5">

        {/* Dashboard */}
        <Link
          href="/dashboard"
          className={cn("flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 group")}
          style={{
            color: pathname === "/dashboard" ? "var(--text-primary)" : "var(--text-muted)",
            background: pathname === "/dashboard" ? "var(--accent-subtle)" : undefined,
          }}
          onMouseEnter={e => { if (pathname !== "/dashboard") (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { if (pathname !== "/dashboard") { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; } }}
        >
          <LayoutGrid className="w-4 h-4 flex-shrink-0" style={{ color: pathname === "/dashboard" ? "var(--accent)" : undefined }} />
          Dashboard
        </Link>

        {/* Projects header */}
        <div className="pt-5 pb-2 px-2.5">
          <span className="section-label">Projects</span>
        </div>

        {/* Inline create */}
        {creating && (
          <form onSubmit={createGroup} className="px-0.5 pb-1 animate-in-up">
            <input
              autoFocus value={newName}
              onChange={e => setNewName(e.target.value)}
              onBlur={() => { if (!newName.trim()) setCreating(false); }}
              onKeyDown={e => e.key === "Escape" && setCreating(false)}
              placeholder="Project name…"
              className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
              style={{ background: "var(--elevated)", border: "1px solid var(--border-accent)", color: "var(--text-primary)" }}
            />
          </form>
        )}

        {/* Group list */}
        {groups.map(group => {
          const active = pathname === `/group/${group.id}`;
          return (
            <Link key={group.id} href={`/group/${group.id}`}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150"
              style={{ color: active ? "var(--text-primary)" : "var(--text-muted)", background: active ? "var(--accent-subtle)" : undefined, fontWeight: active ? 500 : undefined }}
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

        {/* New project button */}
        <button
          onClick={() => { setCreating(true); setNewName(""); }}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm mt-1 transition-all duration-150"
          style={{ color: "var(--text-secondary)", border: "1px dashed var(--border-strong)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
        >
          <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
               style={{ background: "rgba(255,255,255,0.10)", border: "1px solid var(--border-strong)" }}>
            <Plus className="w-2.5 h-2.5" />
          </div>
          New project
        </button>
      </nav>

      {/* User footer */}
      <div style={{ borderTop: "1px solid var(--border)" }} className="px-2.5 py-3">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors group"
             onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"}
             onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}>
          <div className="w-7 h-7 rounded-lg text-[11px] font-bold flex items-center justify-center flex-shrink-0"
               style={{ background: "var(--accent-subtle)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
            {initials}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {userEmail.split("@")[0]}
            </span>
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
