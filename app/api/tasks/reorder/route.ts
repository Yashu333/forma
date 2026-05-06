import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { updates } = await req.json() as {
    updates: { id: string; order: number; statusId: string }[];
  };

  await db.$transaction(
    updates.map(({ id, order, statusId }) =>
      db.task.update({ where: { id }, data: { order, statusId } })
    )
  );

  return NextResponse.json({ ok: true });
}
