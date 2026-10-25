"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Group } from "@/types";
import { Plus, LayoutGrid, LogOut, ChevronRight, ChevronDown, Pencil, Check, Timer, GripVertical, BarChart3, Sun, Search, CalendarDays, ListChecks, CalendarCheck, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { openCommandPalette } from "@/components/command/CommandPalette";
import { clearRuntimeCaches } from "@/lib/pwa/sw-client";
import { closeSidebar, useSidebarOpen } from "@/lib/sidebar-drawer";
import InstallAppButton from "@/components/pwa/InstallAppButton";

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

const PROJECTS_OPEN_KEY = "forma.sidebar.projectsOpen";

function useProjectsOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => {
      try { return localStorage.getItem(PROJECTS_OPEN_KEY) !== "0"; } catch { return true; }
    },
    () => true,
  );
  function setOpen(next: boolean) {
    try { localStorage.setItem(PROJECTS_OPEN_KEY, next ? "1" : "0"); } catch { /* storage blocked: still toggles below */ }
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECTS_OPEN_KEY }));
  }
  return [open, setOpen];
}

function SortableProject({ group, active: isActive }: { group: Group; active: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id });

  return (
    <div ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : undefined,
        position: "relative",
      }}
      className={`group/project flex items-center rounded-md ${isDragging ? "bg-raised" : isActive ? "bg-primary-soft" : "hover:bg-raised"}`}
    >
      <button {...attributes} {...listeners}
        aria-label={`Reorder ${group.name}`}
        className="flex-shrink-0 px-1 py-1.5 cursor-grab active:cursor-grabbing text-muted-foreground opacity-100 lg:opacity-0 lg:group-hover/project:opacity-100 focus-visible:opacity-100 transition-opacity rounded-md"
        style={{ touchAction: "none" }}>
        <GripVertical className="w-3 h-3" aria-hidden="true" />
      </button>
      <Link href={`/group/${group.id}`}
        aria-current={isActive ? "page" : undefined}
        className={`flex items-center gap-2.5 pr-2.5 py-1.5 rounded-md text-sm flex-1 min-w-0 transition-colors ${isActive ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: group.color }} aria-hidden="true" />
        <span className="truncate flex-1">{group.name}</span>
        {isActive && <ChevronRight className="w-3 h-3 flex-shrink-0 text-subtle" aria-hidden="true" />}
      </Link>
    </div>
  );
}

function NavLink({ href, icon: Icon, label, active, external }: {
  href: string; icon: LucideIcon; label: string; active?: boolean; external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-raised hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      {label}
    </Link>
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
  const open                              = useSidebarOpen();
  const [projectsOpen, setProjectsOpen]     = useProjectsOpen();
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

  // Close the drawer when navigating on mobile/tablet
  useEffect(() => { closeSidebar(); }, [pathname]);

  // Escape closes the drawer (under lg; it is never "open" on desktop)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeSidebar(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groups.findIndex(g => g.id === active.id);
    const newIndex = groups.findIndex(g => g.id === over.id);
    const reordered = arrayMove(groups, oldIndex, newIndex);
    setGroups(reordered);
    const updates = reordered.map((g, i) => ({ id: g.id, order: i }));
    fetch("/api/groups/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    // A shared phone must not show the last user's pages (offline copies).
    await clearRuntimeCaches();
    router.push("/login");
  }

  const initials = storedName.slice(0, 2).toUpperCase();

  return (
    <>
      {/* Mobile/tablet: the drawer opens from the bottom tab bar's More (lib/sidebar-drawer). */}
      {/* Overlay backdrop on mobile/tablet */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-background/70"
          onClick={closeSidebar}
        />
      )}

    <aside
      id="app-sidebar"
      className={[
        "flex flex-col h-full z-40 transition-transform duration-300 ease-in-out bg-sidebar border-r border-border",
        // Desktop: always visible, static in flow
        "lg:static lg:translate-x-0 lg:w-56 lg:flex-shrink-0",
        // Mobile/tablet: fixed overlay, slides in/out via transform (not display) so animation works
        "max-lg:fixed max-lg:top-0 max-lg:left-0 max-lg:bottom-0 max-lg:w-72",
        // Over the whole screen there, so keep clear of the notch and the home indicator
        "max-lg:pt-safe max-lg:pb-safe",
        open ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
      ].join(" ")}
    >

      <div className="px-4 h-14 flex items-center border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-2.5 rounded-md">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--primary)" />
            <path d="M11.5 23V9.5H21M11.5 16H18.5" stroke="var(--primary-foreground)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground select-none">Forma</span>
        </Link>
      </div>

      <div className="px-2.5 pt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openCommandPalette("search")}
          className="flex-1 min-w-0 h-8 flex items-center gap-2 px-2.5 rounded-md border border-border bg-surface text-sm text-subtle transition-colors hover:border-border-strong hover:text-foreground"
        >
          <Search className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="font-mono text-xs text-subtle">Ctrl K</kbd>
        </button>
        <Tooltip>
          <TooltipTrigger
            onClick={() => openCommandPalette("add")}
            aria-label="Add task"
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="right">Add task <kbd className="font-mono ml-1">Q</kbd></TooltipContent>
        </Tooltip>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2.5 py-3 flex flex-col gap-px" aria-label="Main">
        <NavLink href="/dashboard" icon={LayoutGrid} label="Dashboard" active={pathname === "/dashboard"} />
        <NavLink href="/today" icon={Sun} label="Today" active={pathname === "/today"} />
        <NavLink href="/calendar" icon={CalendarDays} label="Calendar" active={pathname === "/calendar"} />
        <NavLink href="/habits" icon={ListChecks} label="Habits" active={pathname === "/habits"} />
        <NavLink href="/review" icon={CalendarCheck} label="Weekly review" active={pathname === "/review"} />
        <NavLink href="/reports" icon={BarChart3} label="Reports" active={pathname === "/reports"} />
        <NavLink href="/pomodoro" icon={Timer} label="Pomodoro" external />

        <div className="mt-4 mb-1 flex items-center gap-1 pr-0.5">
          <button
            type="button"
            onClick={() => setProjectsOpen(!projectsOpen)}
            aria-expanded={projectsOpen}
            className="flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-subtle transition-colors hover:text-foreground"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${projectsOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
            Projects
            {groups.length > 0 && <span className="font-normal tabular">{groups.length}</span>}
          </button>
          <Tooltip>
            <TooltipTrigger
              onClick={() => { setCreating(true); setNewName(""); setProjectsOpen(true); }}
              aria-label="New project"
              className="btn-icon"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="right">New project</TooltipContent>
          </Tooltip>
        </div>

        <div className="min-h-0 overflow-y-auto flex flex-col gap-px -mx-1 px-1">
          {creating && (
            <form onSubmit={createGroup} className="px-0.5 pb-1 animate-in-up">
              <input
                autoFocus value={newName}
                onChange={e => setNewName(e.target.value)}
                onBlur={() => { if (!newName.trim()) setCreating(false); }}
                onKeyDown={e => e.key === "Escape" && setCreating(false)}
                placeholder="Project name…"
                aria-label="Project name"
                className="forma-input !py-1.5 !text-sm"
              />
            </form>
          )}

          {/* Collapsed: still show the project you're on, so you can see where you are. */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
            <SortableContext items={groups.map(g => g.id)} strategy={verticalListSortingStrategy}>
              {groups
                .filter(group => projectsOpen || pathname === `/group/${group.id}`)
                .map(group => (
                  <SortableProject key={group.id} group={group} active={pathname === `/group/${group.id}`} />
                ))}
            </SortableContext>
          </DndContext>

          {groups.length === 0 && !creating && projectsOpen && (
            <button
              onClick={() => { setCreating(true); setNewName(""); }}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:bg-raised hover:text-foreground"
            >
              <Plus className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              New project
            </button>
          )}
        </div>
      </nav>

      <div className="px-2.5 py-3 border-t border-border">
        <InstallAppButton />
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors group hover:bg-raised">

          <div className="w-8 h-8 rounded-md text-xs font-semibold flex items-center justify-center flex-shrink-0 select-none bg-raised border border-border text-foreground"
               suppressHydrationWarning>
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
                  aria-label="Display name"
                  className="text-xs font-medium w-full rounded px-1 py-0.5 bg-surface text-foreground border border-border-strong focus:border-primary outline-none"
                />
                <button type="submit" aria-label="Save name" className="flex-shrink-0 text-foreground">
                  <Check className="w-3 h-3" aria-hidden="true" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => { setNameInput(storedName); setEditingName(true); }}
                aria-label="Edit display name"
                className="flex items-center gap-1 group/name text-left w-full"
              >
                <span className="text-xs font-semibold truncate text-foreground" suppressHydrationWarning>
                  {storedName}
                </span>
                <Pencil className="w-2.5 h-2.5 flex-shrink-0 text-subtle opacity-100 lg:opacity-0 lg:group-hover/name:opacity-100 group-focus-visible/name:opacity-100 transition-opacity" aria-hidden="true" />
              </button>
            )}
            <span className="text-xs truncate text-subtle">
              {userEmail}
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger onClick={signOut} aria-label="Sign out" className="btn-icon w-6 h-6 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100">
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
    </>
  );
}
