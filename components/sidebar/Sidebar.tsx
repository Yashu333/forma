"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Group } from "@/types";
import { Plus, LayoutGrid, LogOut, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  userId: string;
  userEmail: string;
}

export default function Sidebar({ userId, userEmail }: Props) {
  const [groups, setGroups]     = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  useEffect(() => { fetchGroups(); }, []);

  async function fetchGroups() {
    const res = await fetch("/api/groups");
    if (res.ok) setGroups(await res.json());
  }

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
      setGroups((prev) => [...prev, group]);
      setNewName("");
      setCreating(false);
      router.push(`/group/${group.id}`);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col h-full bg-[#13151C] border-r border-[#1E2130]">
      {/* Logo */}
      <div className="px-4 h-14 flex items-center border-b border-[#1E2130]">
        <div className="flex items-center gap-2.5">
          {/* Brand mark — orange square grid */}
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
               style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.18) 0%, rgba(251,146,60,0.10) 100%)", border: "1px solid rgba(249,115,22,0.25)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#F97316" opacity="1"/>
              <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#FB923C" opacity="0.6"/>
              <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#FB923C" opacity="0.6"/>
              <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#FBBF24" opacity="0.35"/>
            </svg>
          </div>
          <span className="text-[15px] font-bold brand-text tracking-tight">Forma</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5">
        {/* Dashboard link */}
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 group",
            pathname === "/dashboard"
              ? "bg-violet-500/15 text-violet-300 font-medium"
              : "text-[#5C6180] hover:text-[#F0F2FF] hover:bg-[#1C1E28]"
          )}
        >
          <LayoutGrid className={cn("w-4 h-4 flex-shrink-0 transition-colors",
            pathname === "/dashboard" ? "text-violet-400" : "text-[#3A3D52] group-hover:text-[#A8ADCB]")} />
          Dashboard
        </Link>

        {/* Projects section header */}
        <div className="pt-5 pb-2 px-2.5">
          <span className="section-label">Projects</span>
        </div>

        {/* Inline create input */}
        {creating && (
          <form onSubmit={createGroup} className="px-0.5 pb-1 animate-in-up">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => { if (!newName.trim()) setCreating(false); }}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              placeholder="Project name…"
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#22252F] border border-violet-500/40 text-sm text-[#F0F2FF] placeholder:text-[#3A3D52] focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </form>
        )}

        {/* Group list */}
        {groups.map((group) => {
          const active = pathname === `/group/${group.id}`;
          return (
            <Link
              key={group.id}
              href={`/group/${group.id}`}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 group",
                active
                  ? "bg-violet-500/12 text-[#F0F2FF] font-medium"
                  : "text-[#5C6180] hover:text-[#F0F2FF] hover:bg-[#1C1E28]"
              )}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: group.color, boxShadow: active ? `0 0 6px 1px ${group.color}66` : "none" }}
              />
              <span className="truncate flex-1">{group.name}</span>
              {active && <ChevronRight className="w-3 h-3 text-[#3A3D52] flex-shrink-0" />}
            </Link>
          );
        })}

        {/* New Project button — always visible and prominent */}
        <button
          onClick={() => { setCreating(true); setNewName(""); }}
          className={cn(
            "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 mt-1",
            "text-[#A8ADCB] hover:text-[#F0F2FF] hover:bg-[#1C1E28]",
            "border border-dashed border-[#2A2D3A] hover:border-violet-500/40",
            "group"
          )}
        >
          <div className="w-4 h-4 rounded-md bg-[#22252F] border border-[#2A2D3A] group-hover:border-violet-500/40 group-hover:bg-violet-500/10 flex items-center justify-center transition-all duration-150 flex-shrink-0">
            <Plus className="w-2.5 h-2.5 group-hover:text-violet-400 transition-colors" />
          </div>
          <span>New project</span>
        </button>
      </nav>

      {/* User footer */}
      <div className="px-2.5 py-3 border-t border-[#1E2130]">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[#1C1E28] transition-colors group">
          <div className="w-7 h-7 rounded-lg bg-violet-500/15 text-violet-300 text-[11px] font-bold flex items-center justify-center flex-shrink-0 border border-violet-500/20">
            {initials}
          </div>
          <span className="text-xs text-[#5C6180] truncate flex-1 group-hover:text-[#A8ADCB] transition-colors">
            {userEmail}
          </span>
          <Tooltip>
            <TooltipTrigger
              onClick={signOut}
              className="btn-icon w-6 h-6 opacity-0 group-hover:opacity-100"
            >
              <LogOut className="w-3.5 h-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
