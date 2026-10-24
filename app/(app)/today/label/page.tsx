import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LabelTasks from "@/components/today/LabelTasks";

export const dynamic = "force-dynamic";

export default async function LabelTasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <LabelTasks />;
}
