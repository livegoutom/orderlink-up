import prisma from "../db.server";
import type { ParsedFile } from "../lib/fileParser.server";

export async function createImportJobWithRows(
  shop: string,
  fileName: string,
  fileType: string,
  parsed: ParsedFile,
  orderMode: "draft" | "paid" = "draft",
) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.importJob.create({
      data: {
        shop,
        fileName,
        fileType,
        status: "uploaded",
        headers: JSON.stringify(parsed.headers),
        totalRows: parsed.rows.length,
        orderMode,
      },
    });

    if (parsed.rows.length > 0) {
      await tx.importRow.createMany({
        data: parsed.rows.map((row, index) => ({
          importJobId: job.id,
          rowNumber: index + 1,
          rawData: JSON.stringify(row),
        })),
      });
    }

    return job;
  });
}

export async function listImportJobs(shop: string) {
  return prisma.importJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

export async function getImportJob(shop: string, id: string) {
  return prisma.importJob.findFirst({
    where: { id, shop },
  });
}

export async function getImportJobPreviewRows(importJobId: string, limit = 5) {
  return prisma.importRow.findMany({
    where: { importJobId },
    orderBy: { rowNumber: "asc" },
    take: limit,
  });
}

export async function markJobMatching(shop: string, id: string) {
  return prisma.importJob.updateMany({
    where: { id, shop, status: { in: ["mapped", "validated"] } },
    data: { status: "matching" },
  });
}

export async function updateSuppressNotifications(
  shop: string,
  id: string,
  suppressNotifications: boolean,
) {
  return prisma.importJob.updateMany({
    where: { id, shop, status: "matched" },
    data: { suppressNotifications },
  });
}

export async function markJobCreating(shop: string, id: string) {
  return prisma.importJob.updateMany({
    where: { id, shop, status: "matched" },
    data: { status: "creating", startedAt: new Date() },
  });
}

export async function setImportJobOptions(shop: string, id: string, optionsJson: string) {
  return prisma.importJob.updateMany({
    where: { id, shop },
    data: { options: optionsJson },
  });
}

export async function markJobRollingBack(shop: string, id: string) {
  return prisma.importJob.updateMany({
    where: { id, shop, status: "completed" },
    data: { status: "rolling_back" },
  });
}

export async function deleteImportJob(shop: string, id: string) {
  // ImportRow rows cascade-delete via the schema's onDelete: Cascade — this only removes
  // OrderLink Up's own history record, never touches any Shopify order already created.
  return prisma.importJob.deleteMany({
    where: { id, shop },
  });
}

// GDPR customers/redact: Shopify sends numeric order IDs (not GIDs). ImportRow.shopifyOrderId
// stores a GID (Order or DraftOrder), so build both candidate GID forms to match against.
export async function redactOrdersData(shop: string, orderIds: (string | number)[]) {
  if (orderIds.length === 0) return { count: 0 };
  const candidateIds = orderIds.flatMap((id) => [
    `gid://shopify/Order/${id}`,
    `gid://shopify/DraftOrder/${id}`,
  ]);

  const rows = await prisma.importRow.findMany({
    where: {
      shopifyOrderId: { in: candidateIds },
      importJob: { shop },
    },
    select: { id: true, rawData: true },
  });

  if (rows.length === 0) return { count: 0 };

  await prisma.$transaction(
    rows.map((row) => {
      const cellCount = (JSON.parse(row.rawData) as string[]).length;
      return prisma.importRow.update({
        where: { id: row.id },
        data: { rawData: JSON.stringify(Array(cellCount).fill("[REDACTED]")) },
      });
    }),
  );

  return { count: rows.length };
}

// GDPR shop/redact: delete everything OrderLink Up holds for this shop.
export async function redactAllShopData(shop: string) {
  // ImportRow rows cascade-delete with their ImportJob.
  await prisma.importJob.deleteMany({ where: { shop } });
  await prisma.importTemplate.deleteMany({ where: { shop } });
}

export async function setImportJobMapping(
  shop: string,
  id: string,
  columnMapping: Record<string, string | null>,
  templateId?: string,
) {
  return prisma.importJob.updateMany({
    where: { id, shop },
    data: {
      columnMapping: JSON.stringify(columnMapping),
      status: "mapped",
      ...(templateId ? { templateId } : {}),
    },
  });
}
