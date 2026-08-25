// Shopify App Pricing (enabled 2026-08-01 in the Partner Dashboard) creates subscriptions that
// do NOT show up in the classic Admin GraphQL Billing API (`currentAppInstallation.activeSubscriptions`,
// what `shopify.billing.check()` queries). Shopify's own migration guide: "the Active Subscription
// API returns only Shopify App Pricing contracts... don't treat the app user as unpaid until
// currentAppInstallation also confirms" - so this is queried IN ADDITION TO, never instead of,
// the existing billing.check() calls.
// This is the org ID as it appears in a partners.shopify.com URL specifically (confirmed via
// direct API test) - e.g. https://partners.shopify.com/2851411/settings/... The newer unified
// dev.shopify.com/dashboard/{id}/... uses a COMPLETELY DIFFERENT id scheme for the same org
// (130130154 in this app's case) and does NOT work here - that was the actual root cause of a
// long-standing "Invalid access token" 401 that had nothing to do with the token itself. If this
// ever needs re-deriving, read it from the partners.shopify.com address bar, never dev.shopify.com.
const PARTNER_ORG_ID = "2851411";
// Confusingly, the Partner API's GID namespace for App identity is inconsistent BETWEEN its own
// fields: the standalone `app(id:)` query demands "gid://partners/App/...", but this
// `activeSubscription(appId:)` query demands "gid://shopify/App/..." for the exact same
// underlying app - confirmed by testing both directly, not assumed. Don't "fix" this to
// gid://partners/... again without re-testing against the real activeSubscription query
// specifically, since that mistake (based on testing the wrong field) cost real debugging time.
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

  const json = await response.json();

  // GraphQL errors (bad auth, bad GID, etc.) commonly come back as HTTP 200 with an `errors`
  // array and no `data` - silently falling through to "no subscription found" here is exactly
  // how a real bug (wrong GID namespace) went unnoticed until a live billing test caught it.
  if (!response.ok || json.errors) {
    // Single string argument, not multiple console.error() args - Railway's log ingestion was
    // observed truncating multi-arg output at the first newline/array-open, hiding the real
    // error content and costing real debugging time. Never repeat that mistake here.
    console.error(
      `Partner API activeSubscription query failed: status=${response.status} body=${JSON.stringify(json.errors ?? json)}`,
    );
    return false;
  }

  // A subscription with cancelAtEndOfCycle: true is still active and paid-for through the
  // current billing period - only its NEXT renewal is cancelled, so it still counts as active now.
  const subscription = json.data?.activeSubscription;
  return Boolean(subscription);
}
