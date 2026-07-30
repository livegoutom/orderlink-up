import prisma from "../db.server";
import { validateRow } from "../lib/rowValidation.server";

export async function runValidation(
  importJobId: string,
  headers: string[],
  columnMapping: Record<string, string>,
) {
  const rows = await prisma.importRow.findMany({ where: { importJobId } });

  if (rows.length > 0) {
    await prisma.$transaction(
      rows.map((row) => {
        const cells = JSON.parse(row.rawData) as string[];
        const errors = validateRow(cells, headers, columnMapping);
        return prisma.importRow.update({
          where: { id: row.id },
          data: {
            validationStatus: errors.length > 0 ? "error" : "valid",
            validationErrors: errors.length > 0 ? JSON.stringify(errors) : null,
          },
        });
      }),
    );
  }

  await prisma.importJob.updateMany({
    where: { id: importJobId },
    data: { status: "validated" },
  });
}

export interface ValidationCounts {
  pending: number;
  valid: number;
  error: number;
}

export async function getValidationCounts(importJobId: string): Promise<ValidationCounts> {
  const grouped = await prisma.importRow.groupBy({
    by: ["validationStatus"],
    where: { importJobId },
    _count: { _all: true },
  });

  const counts: ValidationCounts = { pending: 0, valid: 0, error: 0 };
  for (const g of grouped) {
    if (g.validationStatus in counts) {
      counts[g.validationStatus as keyof ValidationCounts] = g._count._all;
    }
  }
  return counts;
}

export interface ValidationErrorGroup {
  message: string;
  rowNumbers: number[];
}

export async function getValidationErrorSummary(importJobId: string): Promise<ValidationErrorGroup[]> {
  const rows = await prisma.importRow.findMany({
    where: { importJobId, validationStatus: "error" },
    orderBy: { rowNumber: "asc" },
  });

  const byMessage = new Map<string, number[]>();
  for (const row of rows) {
    const messages = row.validationErrors ? (JSON.parse(row.validationErrors) as string[]) : [];
    for (const message of messages) {
      const list = byMessage.get(message) ?? [];
      list.push(row.rowNumber);
      byMessage.set(message, list);
    }
  }

  return Array.from(byMessage.entries()).map(([message, rowNumbers]) => ({ message, rowNumbers }));
}

export async function skipErrorRows(importJobId: string) {
  await prisma.importRow.updateMany({
    where: { importJobId, validationStatus: "error" },
    data: { matchStatus: "skipped" },
  });
}
