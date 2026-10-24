import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import HabitsPage from "@/components/habits/HabitsPage";

export const dynamic = "force-dynamic";

export default async function Habits() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // "Today" is the browser's local date, so the client component works it out.
  return <HabitsPage />;
}
