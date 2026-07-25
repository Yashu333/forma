import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ReportsDashboard from "@/components/reports/ReportsDashboard";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <ReportsDashboard />;
}
