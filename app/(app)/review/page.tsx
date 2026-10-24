import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ReviewPage from "@/components/review/ReviewPage";

export const dynamic = "force-dynamic";

export default async function Review() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Which week is up for review depends on the browser's local date.
  return <ReviewPage />;
}
