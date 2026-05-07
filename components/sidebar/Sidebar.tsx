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
  const [groups, setGroups]   = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
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
    <aside className="w-56 flex-shrink-0 flex flex-col h-full bg-[#111009] border-r border-[#1E1B16]">
      {/* Logo */}
      <div className="px-4 h-14 flex items-center border-b border-[#1E1B16]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-orange-500/15 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-orange-400">
              <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" opacity="0.9"/>
              <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" opacity="0.5"/>
              <rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.5"/>
              <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.2"/>
            </svg>
          </div>
          <span className="text-base font-bold gradient-text tracking-tight">Forma</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        {/* Dashboard link */}
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 group",
            pathname === "/dashboard"
              ? "bg-orange-500/12 text-orange-400 font-medium"
              : "text-[#7A6A5A] hover:text-[#EDE0D0] hover:bg-[#1E1B16]"
          )}
        >
          <LayoutGrid className={cn("w-4 h-4 flex-shrink-0 transition-colors", pathname === "/dashboard" ? "text-orange-400" : "text-[#4A3F35] group-hover:text-[#B8A898]")} />
          Dashboard
        </Link>

        {/* Projects section */}
        <div className="pt-4 pb-1.5 px-2.5">
          <div className="flex items-center justify-between">
            <span className="section-label">Projects</span>
            <Tooltip>
              <TooltipTrigger
                onClick={() => { setCreating(true); setNewName(""); }}
                className="btn-icon w-5 h-5"
              >
                <Plus className="w-3.5 h-3.5" />
              </TooltipTrigger>
              <TooltipContent side="right">New project</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Inline create input */}
        {creating && (
          <form onSubmit={createGroup} className="px-0.5 py-0.5 animate-in-up">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => { if (!newName.trim()) setCreating(false); }}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              placeholder="Project name…"
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#221F1A] border border-orange-500/30 text-sm text-[#EDE0D0] placeholder:text-[#4A3F35] focus:outline-none focus:ring-1 focus:ring-orange-500/40"
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
                  ? "bg-orange-500/12 text-[#EDE0D0] font-medium"
                  : "text-[#7A6A5A] hover:text-[#EDE0D0] hover:bg-[#1E1B16]"
              )}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: group.color, boxShadow: active ? `0 0 6px 1px ${group.color}66` : "none" }}
              />
              <span className="truncate flex-1">{group.name}</span>
              {active && <ChevronRight className="w-3 h-3 text-[#4A3F35] flex-shrink-0" />}
            </Link>
          );
        })}

        {groups.length === 0 && !creating && (
          <button
            onClick={() => { setCreating(true); setNewName(""); }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-[#4A3F35] hover:text-[#7A6A5A] hover:bg-[#1E1B16] transition-all duration-150 border border-dashed border-[#2C2820] hover:border-[#3C3828] mt-1"
          >
            <Plus className="w-3.5 h-3.5" />
            New project
          </button>
        )}
      </nav>

      {/* User footer */}
      <div className="px-2.5 py-3 border-t border-[#1E1B16]">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[#1E1B16] transition-colors group">
          <div className="w-7 h-7 rounded-lg bg-orange-500/15 text-orange-400 text-[11px] font-bold flex items-center justify-center flex-shrink-0 border border-orange-500/15">
            {initials}
          </div>
          <span className="text-xs text-[#7A6A5A] truncate flex-1 group-hover:text-[#B8A898] transition-colors">
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
