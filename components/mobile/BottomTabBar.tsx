"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, LayoutGrid, Menu, Plus, Sun, type LucideIcon } from "lucide-react";
import { openCommandPalette } from "@/components/command/CommandPalette";
import { openSidebar, useSidebarOpen } from "@/lib/sidebar-drawer";
import { activeTab } from "@/lib/mobile-tabs";

// Navigation under `lg` (docs/mobile-pwa/SPEC.md, decision 4): Today, Board,
// Add, Calendar, More. Fixed to the bottom above the home indicator; `main`
// pads itself by the same height (`pb-tabbar`). Hidden at `lg` and up.

const ITEM = "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 min-h-11 text-[11px] font-medium leading-none transition-colors";
/** Every icon sits in the same 44×28 slot so the labels line up. */
const SLOT = "w-11 h-7 flex items-center justify-center rounded-lg";

function TabLink({ href, icon: Icon, label, active }: { href: string; icon: LucideIcon; label: string; active: boolean }) {
  return (
    <li className="flex flex-1 min-w-0">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`${ITEM} ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        <span className={`${SLOT} ${active ? "bg-primary-soft text-primary" : ""}`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </span>
        <span>{label}</span>
      </Link>
    </li>
  );
}

export default function BottomTabBar() {
  const pathname = usePathname();
  const drawerOpen = useSidebarOpen();
  const active = activeTab(pathname);

  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed inset-x-0 bottom-0 z-20 bg-surface border-t border-border pb-safe px-safe select-none"
    >
      <ul className="flex items-stretch h-(--tabbar-h)">
        <TabLink href="/today" icon={Sun} label="Today" active={active === "today"} />
        <TabLink href="/dashboard" icon={LayoutGrid} label="Board" active={active === "board"} />
        <li className="flex flex-1 min-w-0">
          <button
            type="button"
            onClick={() => openCommandPalette("add")}
            aria-label="Add task"
            className={`${ITEM} text-muted-foreground hover:text-foreground`}
          >
            <span className={`${SLOT} bg-primary text-primary-foreground`}>
              <Plus className="w-5 h-5" aria-hidden="true" />
            </span>
            <span aria-hidden="true">Add</span>
          </button>
        </li>
        <TabLink href="/calendar" icon={CalendarDays} label="Calendar" active={active === "calendar"} />
        <li className="flex flex-1 min-w-0">
          <button
            type="button"
            onClick={openSidebar}
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            className={`${ITEM} text-muted-foreground hover:text-foreground`}
          >
            <span className={SLOT}>
              <Menu className="w-5 h-5" aria-hidden="true" />
            </span>
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
