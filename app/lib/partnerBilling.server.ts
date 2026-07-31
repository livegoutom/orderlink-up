// Shopify App Pricing (enabled 2026-08-01 in the Partner Dashboard) creates subscriptions that
// do NOT show up in the classic Admin GraphQL Billing API (`currentAppInstallation.activeSubscriptions`,
// what `shopify.billing.check()` queries). Shopify's own migration guide: "the Active Subscription
// API returns only Shopify App Pricing contracts... don't treat the app user as unpaid until
// currentAppInstallation also confirms" - so this is queried IN ADDITION TO, never instead of,
// the existing billing.check() calls.
const PARTNER_ORG_ID = "130130154";
const PARTNER_APP_GID = "gid://shopify/App/404120436737";

const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query ActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      cancelAtEndOfCycle
      items {
        handle
      }
    }
  }
`;

// Resolves a shop's GID via the merchant-scoped Admin API - the Partner API's activeSubscription
// query needs this, and we only have the shop's domain string from the session.
export async function getShopGid(admin: { graphql: (query: string) => Promise<Response> }): Promise<string> {
  const response = await admin.graphql(`#graphql
    query ShopId {
      shop {
        id
      }
    }
  `);
  const json = await response.json();
  return json.data.shop.id as string;
}

export async function hasActiveAppPricingSubscription(shopGid: string): Promise<boolean> {
  const token = process.env.SHOPIFY_PARTNER_API_TOKEN;
  if (!token) {
    // Not configured locally/in this environment - callers already fall back to the classic
    // billing.check() result, so this just means we skip the extra check rather than error.
    return false;
  }

  const response = await fetch(
    `https://partners.shopify.com/${PARTNER_ORG_ID}/api/2026-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: ACTIVE_SUBSCRIPTION_QUERY,
        variables: { appId: PARTNER_APP_GID, shopId: shopGid },
      }),
    },
  );

  if (!response.ok) return false;

  const json = await response.json();
  // A subscription with cancelAtEndOfCycle: true is still active and paid-for through the
  // current billing period - only its NEXT renewal is cancelled, so it still counts as active now.
  const subscription = json.data?.activeSubscription;
  return Boolean(subscription);
}
