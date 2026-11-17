import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { prisma } from "@/server/db";

const STAGES = new Set(["DATA", "VALIDATION", "RATIOS", "MODEL", "REPORT", "REVIEW"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await params;
  const { stage, seconds } = await req.json();
  if (!STAGES.has(stage) || typeof seconds !== "number" || seconds <= 0 || seconds > 60) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const a = await prisma.analysis.findUnique({ where: { id } });
  if (!a || a.ownerId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const day = new Date().toISOString().slice(0, 10);
  await prisma.timeEntry.upsert({
    where: { analysisId_userId_stage_day: { analysisId: id, userId: user.id, stage, day } },
    create: { analysisId: id, userId: user.id, stage, day, seconds },
    update: { seconds: { increment: seconds } },
  });
  return NextResponse.json({ ok: true });
}
