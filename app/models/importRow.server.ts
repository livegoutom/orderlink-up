import prisma from "../db.server";
import type { MatchResult } from "../lib/productMatcher.server";

export async function getPendingRowsBatch(importJobId: string, limit: number) {
  return prisma.importRow.findMany({
    where: { importJobId, matchStatus: "pending" },
    orderBy: { rowNumber: "asc" },
    take: limit,
  });
}

export interface MatchStatusCounts {
  pending: number;
  matched: number;
  unmatched: number;
  custom_line_item: number;
  skipped: number;
}

export async function getMatchStatusCounts(importJobId: string): Promise<MatchStatusCounts> {
  const grouped = await prisma.importRow.groupBy({
    by: ["matchStatus"],
    where: { importJobId },
    _count: { _all: true },
  });

  const counts: MatchStatusCounts = {
    pending: 0,
    matched: 0,
    unmatched: 0,
    custom_line_item: 0,
    skipped: 0,
  };
  for (const g of grouped) {
    if (g.matchStatus in counts) {
      counts[g.matchStatus as keyof MatchStatusCounts] = g._count._all;
    }
  }
  return counts;
}

export async function applyMatchResults(
  importJobId: string,
  updates: { rowId: string; result: MatchResult }[],
) {
  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map(({ rowId, result }) =>
        prisma.importRow.updateMany({
          where: { id: rowId, importJobId },
          data: {
            matchStatus: result.matchedVariantId ? "matched" : "unmatched",
            matchType: result.matchType,
            matchedVariantId: result.matchedVariantId,
            matchedVariantTitle: result.matchedVariantTitle,
          },
        }),
      ),
    );
  }
  await maybeFinalizeMatching(importJobId);
}

export async function getUnmatchedRows(importJobId: string) {
  return prisma.importRow.findMany({
    where: { importJobId, matchStatus: "unmatched" },
    orderBy: { rowNumber: "asc" },
  });
}

export async function resolveRow(
  importJobId: string,
  rowId: string,
  resolution: "custom_line_item" | "skipped" | "manual",
  manualVariant?: { id: string; title: string },
) {
  await prisma.importRow.updateMany({
    where: { id: rowId, importJobId },
    data:
      resolution === "manual"
        ? {
            matchStatus: "matched",
            matchType: "manual",
            matchedVariantId: manualVariant?.id ?? null,
            matchedVariantTitle: manualVariant?.title ?? null,
          }
        : {
            matchStatus: resolution,
            matchType: null,
            matchedVariantId: null,
            matchedVariantTitle: null,
          },
  });
  await maybeFinalizeMatching(importJobId);
}

export async function bulkResolveUnmatched(
  importJobId: string,
  resolution: "custom_line_item" | "skipped",
) {
  await prisma.importRow.updateMany({
    where: { importJobId, matchStatus: "unmatched" },
    data: { matchStatus: resolution },
  });
  await maybeFinalizeMatching(importJobId);
}

async function maybeFinalizeMatching(importJobId: string) {
  const remaining = await prisma.importRow.count({
    where: { importJobId, matchStatus: { in: ["pending", "unmatched"] } },
  });
  if (remaining === 0) {
    await prisma.importJob.updateMany({
      where: { id: importJobId, status: { in: ["mapped", "validated", "matching"] } },
      data: { status: "matched" },
    });
  }
}
