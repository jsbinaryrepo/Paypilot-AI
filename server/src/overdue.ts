import type { PrismaClient } from "@prisma/client";

export function daysOverdue(dueDate: Date, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return Math.max(0, Math.floor((today - due) / 86_400_000));
}

export async function refreshOverdue(db: PrismaClient, userId?: string, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return db.invoice.updateMany({
    where: { ...(userId ? { userId } : {}), status: "ISSUED", dueDate: { lt: today } },
    data: { status: "OVERDUE", version: { increment: 1 } },
  });
}
