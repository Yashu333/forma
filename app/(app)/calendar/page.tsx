import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CalendarView from "@/components/calendar/CalendarView";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Which days are "today" and what zone to bucket due dates in are the browser's call.
  return <CalendarView userId={user.id} />;
}
