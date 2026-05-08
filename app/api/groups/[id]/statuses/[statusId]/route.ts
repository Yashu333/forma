import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; statusId: string }> },
) {
  const { id, statusId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await db.group.findFirst({ where: { id, ownerId: user.id } });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const data: { celebrate?: boolean; name?: string } = {};
  if (typeof body.celebrate === "boolean") data.celebrate = body.celebrate;
  if (typeof body.name === "string") data.name = body.name;

  const status = await db.status.update({ where: { id: statusId }, data });
  return NextResponse.json(status);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; statusId: string }> },
) {
  const { id, statusId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await db.group.findFirst({ where: { id, ownerId: user.id } });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // the Status→Task relation has no onDelete cascade so we delete tasks first.
  await db.task.deleteMany({ where: { statusId } });
  await db.status.delete({ where: { id: statusId } });

  return new NextResponse(null, { status: 204 });
}
