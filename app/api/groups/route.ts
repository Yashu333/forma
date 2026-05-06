import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groups = await db.group.findMany({
    where: { ownerId: user.id },
    orderBy: { order: "asc" },
    include: { _count: { select: { tasks: { where: { parentTaskId: null } } } } },
  });

  return NextResponse.json(groups);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, color } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const count = await db.group.count({ where: { ownerId: user.id } });

  const group = await db.group.create({
    data: {
      name: name.trim(),
      color: color ?? "#F97316",
      ownerId: user.id,
      order: count,
      statuses: {
        create: [
          { name: "To Do",  order: 0 },
          { name: "Doing",  order: 1 },
          { name: "Done",   order: 2 },
        ],
      },
    },
    include: { statuses: true },
  });

  return NextResponse.json(group, { status: 201 });
}
