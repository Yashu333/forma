import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await db.group.findFirst({ where: { id, ownerId: user.id } });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { name, order } = await req.json();
  const status = await db.status.create({ data: { name, groupId: id, order: order ?? 0 } });

  return NextResponse.json(status, { status: 201 });
}
