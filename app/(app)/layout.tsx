import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/sidebar/Sidebar";
import CommandPalette from "@/components/command/CommandPalette";
import BottomTabBar from "@/components/mobile/BottomTabBar";
import OfflineBanner from "@/components/pwa/OfflineBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // A column: the offline bar (only while offline) on top, then the sidebar and
  // page row. The shell keeps clear of the notch (pt-safe; 0 on desktop). Under
  // lg the bottom tab bar is fixed over the bottom edge, so main pads itself by
  // its height; pages scroll inside their own h-full wrappers, which end above it.
  return (
    <div className="app-shell flex flex-col h-dvh overflow-hidden bg-background pt-safe px-safe">
      <OfflineBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar userId={user.id} userEmail={user.email ?? ""} />
        <main className="flex-1 overflow-hidden min-w-0 max-lg:pb-tabbar">{children}</main>
      </div>
      <BottomTabBar />
      <CommandPalette />
    </div>
  );
}
