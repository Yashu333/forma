import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { updates } = await req.json() as {
    updates: { id: string; order: number }[];
  };

  await db.$transaction(
    updates.map(({ id, order }) =>
      db.group.update({ where: { id }, data: { order } })
    )
  );

  return NextResponse.json({ ok: true });
}
