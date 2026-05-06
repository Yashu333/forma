import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "Body required" }, { status: 400 });

  const comment = await db.comment.create({
    data: { taskId: id, authorId: user.id, body: body.trim() },
  });

  await db.activity.create({
    data: { taskId: id, userId: user.id, action: "commented" },
  });

  return NextResponse.json(comment, { status: 201 });
}
