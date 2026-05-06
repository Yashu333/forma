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
    <aside className="w-56 flex-shrink-0 bg-card border-r border-border flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border">
        <span className="text-xl font-bold gradient-text">Forma</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        <Link
          href="/dashboard"
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
            pathname === "/dashboard"
              ? "bg-accent/15 text-accent font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          )}
        >
          <LayoutGrid className="w-4 h-4" />
          Dashboard
        </Link>

        <div className="pt-3 pb-1 px-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Projects</span>
            <Tooltip>
              <TooltipTrigger
                onClick={() => setCreating(true)}
                className="text-muted-foreground hover:text-accent transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </TooltipTrigger>
              <TooltipContent>New project</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {creating && (
          <form onSubmit={createGroup} className="px-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => { if (!newName.trim()) setCreating(false); }}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              placeholder="Project name"
              className="w-full px-3 py-1.5 rounded-lg bg-background border border-accent/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
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
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors group",
                active
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: group.color }} />
              <span className="truncate">{group.name}</span>
              {active && <ChevronRight className="w-3 h-3 ml-auto opacity-60" />}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-border flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-accent/20 text-accent text-xs font-semibold flex items-center justify-center flex-shrink-0">
          {initials}
        </div>
        <span className="text-xs text-muted-foreground truncate flex-1">{userEmail}</span>
        <button onClick={signOut} className="text-muted-foreground hover:text-foreground transition-colors">
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
}
