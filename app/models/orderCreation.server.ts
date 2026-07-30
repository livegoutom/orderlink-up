import prisma from "../db.server";
import { computeGroupKey } from "../lib/orderGrouping.server";

export async function prepareOrderGroups(
  importJobId: string,
  headers: string[],
  columnMapping: Record<string, string>,
) {
  const alreadyPrepared = await prisma.importRow.count({
    where: { importJobId, groupKey: { not: null } },
  });
  if (alreadyPrepared > 0) return;

  const rows = await prisma.importRow.findMany({ where: { importJobId } });
  if (rows.length === 0) return;

  await prisma.$transaction(
    rows.map((row) => {
      const cells = JSON.parse(row.rawData) as string[];
      const groupKey = computeGroupKey(cells, headers, columnMapping, row.id);
      return prisma.importRow.update({
        where: { id: row.id },
        data: {
          groupKey,
          status: row.matchStatus === "skipped" ? "skipped" : row.status,
        },
      });
    }),
  );
}

export async function countOrderGroups(importJobId: string): Promise<number> {
  const rows = await prisma.importRow.findMany({
    where: { importJobId, groupKey: { not: null } },
    select: { groupKey: true },
    distinct: ["groupKey"],
  });
  return rows.length;
}

export async function getNextPendingGroupKeys(importJobId: string, limit: number): Promise<string[]> {
  const rows = await prisma.importRow.findMany({
    where: { importJobId, status: "pending", groupKey: { not: null } },
    select: { groupKey: true },
    orderBy: { rowNumber: "asc" },
  });

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const key = row.groupKey!;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
      if (result.length >= limit) break;
    }
  }
  return result;
}

export async function getRowsForGroups(importJobId: string, groupKeys: string[]) {
  const rows = await prisma.importRow.findMany({
    where: { importJobId, groupKey: { in: groupKeys } },
    orderBy: { rowNumber: "asc" },
  });

  const byGroup = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.groupKey!;
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }
  return byGroup;
}

export async function markGroupImported(importJobId: string, groupKey: string, shopifyOrderId: string) {
  await prisma.importRow.updateMany({
    where: { importJobId, groupKey, status: "pending" },
    data: { status: "imported", shopifyOrderId },
  });
  await maybeFinalizeCreation(importJobId);
}

export async function markGroupSkipped(importJobId: string, groupKey: string) {
  await prisma.importRow.updateMany({
    where: { importJobId, groupKey, status: "pending" },
    data: { status: "skipped" },
  });
  await maybeFinalizeCreation(importJobId);
}

export async function markGroupError(importJobId: string, groupKey: string, message: string) {
  await prisma.importRow.updateMany({
    where: { importJobId, groupKey, status: "pending" },
    data: { status: "error", errors: JSON.stringify([message]) },
  });
  await maybeFinalizeCreation(importJobId);
}

export interface OrderCreationCounts {
  pending: number;
  imported: number;
  error: number;
  skipped: number;
}

export async function getOrderCreationCounts(importJobId: string): Promise<OrderCreationCounts> {
  const grouped = await prisma.importRow.groupBy({
    by: ["status"],
    where: { importJobId },
    _count: { _all: true },
  });

  const counts: OrderCreationCounts = { pending: 0, imported: 0, error: 0, skipped: 0 };
  for (const g of grouped) {
    if (g.status in counts) {
      counts[g.status as keyof OrderCreationCounts] = g._count._all;
    }
  }
  return counts;
}

export interface ErrorGroup {
  groupKey: string;
  message: string;
  rowNumbers: number[];
}

export async function getErrorGroups(importJobId: string): Promise<ErrorGroup[]> {
  const rows = await prisma.importRow.findMany({
    where: { importJobId, status: "error" },
    orderBy: { rowNumber: "asc" },
  });

  const byGroup = new Map<string, ErrorGroup>();
  for (const row of rows) {
    const key = row.groupKey!;
    const message = row.errors ? ((JSON.parse(row.errors) as string[])[0] ?? "Unknown error") : "Unknown error";
    const existing = byGroup.get(key);
    if (existing) {
      existing.rowNumbers.push(row.rowNumber);
    } else {
      byGroup.set(key, { groupKey: key, message, rowNumbers: [row.rowNumber] });
    }
  }
  return Array.from(byGroup.values());
}

export async function retryGroup(importJobId: string, groupKey: string) {
  await prisma.importRow.updateMany({
    where: { importJobId, groupKey, status: "error" },
    data: { status: "pending", errors: null },
  });
}

async function maybeFinalizeCreation(importJobId: string) {
  const remaining = await prisma.importRow.count({
    where: { importJobId, status: "pending" },
  });
  if (remaining === 0) {
    await prisma.importJob.updateMany({
      where: { id: importJobId, status: { in: ["matched", "creating"] } },
      data: { status: "completed", completedAt: new Date() },
    });
  }
}
