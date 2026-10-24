import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TodayView from "@/components/today/TodayView";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // "Today" is the browser's local date, so the client component works it out.
  return <TodayView />;
}
