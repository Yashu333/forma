"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Group } from "@/types";
import { Plus, LayoutGrid, LogOut, ChevronRight, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  userId: string;
  userEmail: string;
}

export default function Sidebar({ userId, userEmail }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    fetchGroups();
  }, []);

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
    <aside className="w-56 flex-shrink-0 bg-card border-r border-border/60 flex flex-col h-full shadow-[1px_0_0_0_rgba(61,45,30,0.4)]">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border/60">
        <span className="text-xl font-bold gradient-text">Forma</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150",
            pathname === "/dashboard"
              ? "bg-accent/15 text-accent font-medium shadow-[inset_0_0_0_1px_rgba(249,115,22,0.15)]"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          )}
        >
          <LayoutGrid className="w-4 h-4" />
          Dashboard
        </Link>

        <div className="pt-4 pb-1.5 px-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Projects</span>
            <Tooltip>
              <TooltipTrigger
                onClick={() => setCreating(true)}
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-accent hover:bg-accent/10 active:bg-accent/20 transition-all duration-150"
              >
                <Plus className="w-3.5 h-3.5" />
              </TooltipTrigger>
              <TooltipContent>New project</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {creating && (
          <form onSubmit={createGroup} className="px-1 py-0.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => { if (!newName.trim()) setCreating(false); }}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              placeholder="Project name…"
              className="w-full px-3 py-1.5 rounded-lg bg-background border border-accent/60 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </form>
        )}

        {groups.map((group) => {
          const active = pathname === `/group/${group.id}`;
          return (
            <Link
              key={group.id}
              href={`/group/${group.id}`}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 group",
                active
                  ? "bg-accent/15 text-accent font-medium shadow-[inset_0_0_0_1px_rgba(249,115,22,0.15)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              )}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0 shadow-[0_0_4px_1px_var(--dot-glow)]"
                style={{ background: group.color, ["--dot-glow" as string]: group.color + "55" }}
              />
              <span className="truncate">{group.name}</span>
              {active && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-border/60 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-accent/20 text-accent text-xs font-semibold flex items-center justify-center flex-shrink-0 shadow-[0_0_8px_2px_rgba(249,115,22,0.15)]">
          {initials}
        </div>
        <span className="text-xs text-muted-foreground truncate flex-1">{userEmail}</span>
        <button
          onClick={signOut}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary/60 transition-all duration-150"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
}
