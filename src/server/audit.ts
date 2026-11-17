// AUD-02: every user action is logged with user and time. Rows are append-only (DB triggers).
import { prisma } from "./db";
import type { SessionUser } from "./auth";

export async function audit(
  user: Pick<SessionUser, "id" | "name">,
  action: string,
  entity: string,
  entityId: string | null,
  detail: unknown,
  analysisId: string | null = null,
) {
  await prisma.auditLog.create({
    data: { analysisId, userId: user.id, userName: user.name, action, entity, entityId, detail: JSON.stringify(detail ?? {}) },
  });
}
