import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NewTasks from "@/components/today/NewTasks";

export const dynamic = "force-dynamic";

export default async function NewTasksPage({ searchParams }: { searchParams: Promise<{ day?: string | string[] }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { day } = await searchParams;
  return <NewTasks forTomorrow={day === "tomorrow"} />;
}
