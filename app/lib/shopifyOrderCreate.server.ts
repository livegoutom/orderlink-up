import type { AdminGraphqlClient } from "./productMatcher.server";

export interface CreateResult {
  orderId: string | null;
  orderName: string | null;
  userErrors: { field: string[] | null; message: string }[];
}

const DRAFT_ORDER_CREATE_MUTATION = `#graphql
  mutation CreateDraftOrder($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id name }
      userErrors { field message }
    }
  }
`;

const ORDER_CREATE_MUTATION = `#graphql
  mutation CreateOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message }
    }
  }
`;

export async function createDraftOrder(
  admin: { graphql: AdminGraphqlClient },
  draftInput: Record<string, unknown>,
): Promise<CreateResult> {
  let json = await executeWithThrottleRetry(admin, DRAFT_ORDER_CREATE_MUTATION, { input: draftInput });
  let payload = json.data?.draftOrderCreate;

  if (isRateLimited(payload?.userErrors)) {
    await sleep(RATE_LIMIT_BACKOFF_MS);
    json = await executeWithThrottleRetry(admin, DRAFT_ORDER_CREATE_MUTATION, { input: draftInput });
    payload = json.data?.draftOrderCreate;
  }

  return {
    orderId: payload?.draftOrder?.id ?? null,
    orderName: payload?.draftOrder?.name ?? null,
    userErrors: payload?.userErrors ?? topLevelErrorsAsUserErrors(json),
  };
}

export async function createPaidOrder(
  admin: { graphql: AdminGraphqlClient },
  orderInput: Record<string, unknown>,
  options: Record<string, unknown>,
): Promise<CreateResult> {
  let json = await executeWithThrottleRetry(admin, ORDER_CREATE_MUTATION, { order: orderInput, options });
  let payload = json.data?.orderCreate;

  if (isRateLimited(payload?.userErrors)) {
    await sleep(RATE_LIMIT_BACKOFF_MS);
    json = await executeWithThrottleRetry(admin, ORDER_CREATE_MUTATION, { order: orderInput, options });
    payload = json.data?.orderCreate;
  }

  return {
    orderId: payload?.order?.id ?? null,
    orderName: payload?.order?.name ?? null,
    userErrors: payload?.userErrors ?? topLevelErrorsAsUserErrors(json),
  };
}

// "Too many attempts" is a business-level order-creation rate limit, distinct from GraphQL
// cost-based THROTTLED errors - it comes back as a normal userErrors entry, not a top-level
// GraphQL error, and needs a much longer backoff than query-cost throttling.
const RATE_LIMIT_BACKOFF_MS = 20000;

function isRateLimited(userErrors: { message: string }[] | undefined): boolean {
  return Boolean(userErrors?.some((e) => /too many attempts/i.test(e.message)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getShopCurrency(admin: { graphql: AdminGraphqlClient }): Promise<string> {
  const response = await admin.graphql(`#graphql
    query ShopCurrency {
      shop { currencyCode }
    }
  `);
  const json = await response.json();
  return json.data?.shop?.currencyCode ?? "USD";
}

function topLevelErrorsAsUserErrors(json: {
  errors?: { message: string }[];
}): { field: string[] | null; message: string }[] {
  if (!Array.isArray(json.errors) || json.errors.length === 0) return [];
  return json.errors.map((e) => ({ field: null, message: e.message }));
}

async function executeWithThrottleRetry(
  admin: { graphql: AdminGraphqlClient },
  query: string,
  variables: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();

  const throttled = Array.isArray(json.errors)
    ? json.errors.some((e: { extensions?: { code?: string } }) => e.extensions?.code === "THROTTLED")
    : false;

  if (throttled) {
    const restoreRate = json.extensions?.cost?.throttleStatus?.restoreRate ?? 50;
    const delayMs = Math.min(2000, Math.max(200, Math.ceil((1 / restoreRate) * 1000)));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const retryResponse = await admin.graphql(query, { variables });
    return retryResponse.json();
  }

  return json;
}
