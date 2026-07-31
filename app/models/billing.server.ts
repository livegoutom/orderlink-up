import prisma from "../db.server";
import { authenticate, UNLIMITED_PLANS, billingPlans } from "../shopify.server";
import { getShopGid, hasActiveAppPricingSubscription } from "../lib/partnerBilling.server";

export const FREE_ORDER_LIMIT = 25;

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];
type Billing = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

/**
 * Checks BOTH the classic Billing API (this app's own subscriptions, created via
 * billing.request()) AND Shopify App Pricing (subscriptions merchants create through Shopify's
 * own plan-selection UI, which do not appear in the classic API's response). See
 * partnerBilling.server.ts for why both checks are required.
 */
export async function checkHasActivePayment(admin: Admin, billing: Billing): Promise<boolean> {
  const classicResult = await billing.check({ plans: billingPlans(...UNLIMITED_PLANS), isTest: true });
  if (classicResult.hasActivePayment) return true;

  // The Partner API check is a best-effort supplement, not a required dependency - any failure
  // here (network issue, shop GID lookup failure, malformed response) should fall back to "no
  // active App Pricing subscription found" rather than crashing the whole page. The classic
  // check above is already the source of truth for this app's own subscriptions.
  try {
    const shopGid = await getShopGid(admin);
    return await hasActiveAppPricingSubscription(shopGid);
  } catch (err) {
    console.error("Partner API App Pricing check failed, falling back to classic billing only:", err);
    return false;
  }
}

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
