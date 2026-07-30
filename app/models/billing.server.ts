import prisma from "../db.server";

export const FREE_ORDER_LIMIT = 25;

/**
 * Distinct Shopify orders (draft or paid - both are real records the app created) ever
 * successfully created for this shop. Lifetime, not scoped to a billing period.
 */
export async function countLifetimeImportedOrders(shop: string): Promise<number> {
  const rows = await prisma.importRow.findMany({
    where: { importJob: { shop }, status: "imported", shopifyOrderId: { not: null } },
    select: { shopifyOrderId: true },
    distinct: ["shopifyOrderId"],
  });
  return rows.length;
}

export async function countLifetimeImportedRows(shop: string): Promise<number> {
  return prisma.importRow.count({
    where: { importJob: { shop }, status: "imported" },
  });
}
