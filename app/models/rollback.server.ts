import prisma from "../db.server";

export async function getNextImportedOrderIds(importJobId: string, limit: number): Promise<string[]> {
  const rows = await prisma.importRow.findMany({
    where: { importJobId, status: "imported", shopifyOrderId: { not: null } },
    select: { shopifyOrderId: true },
    orderBy: { rowNumber: "asc" },
  });

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const id = row.shopifyOrderId!;
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
      if (result.length >= limit) break;
    }
  }
  return result;
}

export async function markOrderRolledBack(importJobId: string, shopifyOrderId: string) {
  await prisma.importRow.updateMany({
    where: { importJobId, shopifyOrderId, status: "imported" },
    data: { status: "rolled_back", errors: null },
  });
  await maybeFinalizeRollback(importJobId);
}

export async function markOrderRollbackError(importJobId: string, shopifyOrderId: string, message: string) {
  await prisma.importRow.updateMany({
    where: { importJobId, shopifyOrderId, status: "imported" },
    data: { status: "rollback_error", errors: JSON.stringify([message]) },
  });
  await maybeFinalizeRollback(importJobId);
}

export interface RollbackCounts {
  imported: number;
  rolled_back: number;
  rollback_error: number;
}

export async function getRollbackCounts(importJobId: string): Promise<RollbackCounts> {
  const grouped = await prisma.importRow.groupBy({
    by: ["status"],
    where: { importJobId, status: { in: ["imported", "rolled_back", "rollback_error"] } },
    _count: { _all: true },
  });

  const counts: RollbackCounts = { imported: 0, rolled_back: 0, rollback_error: 0 };
  for (const g of grouped) {
    if (g.status in counts) {
      counts[g.status as keyof RollbackCounts] = g._count._all;
    }
  }
  return counts;
}

export interface RollbackErrorGroup {
  shopifyOrderId: string;
  message: string;
}

export async function getRollbackErrorGroups(importJobId: string): Promise<RollbackErrorGroup[]> {
  const rows = await prisma.importRow.findMany({
    where: { importJobId, status: "rollback_error" },
  });

  const byOrder = new Map<string, string>();
  for (const row of rows) {
    if (!row.shopifyOrderId || byOrder.has(row.shopifyOrderId)) continue;
    const message = row.errors ? ((JSON.parse(row.errors) as string[])[0] ?? "Unknown error") : "Unknown error";
    byOrder.set(row.shopifyOrderId, message);
  }

  return Array.from(byOrder.entries()).map(([shopifyOrderId, message]) => ({ shopifyOrderId, message }));
}

export async function retryRollbackOrder(importJobId: string, shopifyOrderId: string) {
  await prisma.importRow.updateMany({
    where: { importJobId, shopifyOrderId, status: "rollback_error" },
    data: { status: "imported", errors: null },
  });
}

async function maybeFinalizeRollback(importJobId: string) {
  const remaining = await prisma.importRow.count({
    where: { importJobId, status: "imported" },
  });
  if (remaining === 0) {
    await prisma.importJob.updateMany({
      where: { id: importJobId, status: { in: ["completed", "rolling_back"] } },
      data: { status: "rolled_back" },
    });
  }
}
