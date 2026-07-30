import type { AdminGraphqlClient } from "./productMatcher.server";

export interface RollbackResult {
  success: boolean;
  error?: string;
}

const ORDER_CANCEL_MUTATION = `#graphql
  mutation CancelOrder($orderId: ID!) {
    orderCancel(orderId: $orderId, reason: OTHER, restock: false, notifyCustomer: false) {
      job { id done }
      userErrors { field message }
    }
  }
`;

const JOB_STATUS_QUERY = `#graphql
  query JobStatus($id: ID!) {
    job(id: $id) { id done }
  }
`;

const ORDER_DELETE_MUTATION = `#graphql
  mutation DeleteOrder($orderId: ID!) {
    orderDelete(orderId: $orderId) {
      deletedId
      userErrors { field message }
    }
  }
`;

const DRAFT_ORDER_DELETE_MUTATION = `#graphql
  mutation DeleteDraftOrder($input: DraftOrderDeleteInput!) {
    draftOrderDelete(input: $input) {
      deletedId
      userErrors { field message }
    }
  }
`;

export async function cancelAndDeleteOrder(
  admin: { graphql: AdminGraphqlClient },
  orderId: string,
): Promise<RollbackResult> {
  // Cancel first (required before an imported order is eligible for deletion). A failure here
  // is often benign (e.g. already cancelled) so we proceed to the delete attempt regardless -
  // the delete call's own result is the real success/failure signal. orderCancel is async
  // (returns a Job), so poll briefly for it to finish before attempting delete - otherwise the
  // delete would very often fail on the first try simply because cancellation hasn't landed yet.
  const cancelJson = await executeWithThrottleRetry(admin, ORDER_CANCEL_MUTATION, { orderId });
  const jobId: string | undefined = cancelJson.data?.orderCancel?.job?.id;
  if (jobId) {
    await waitForJob(admin, jobId);
  }

  const deleteJson = await executeWithThrottleRetry(admin, ORDER_DELETE_MUTATION, { orderId });
  const payload = deleteJson.data?.orderDelete;
  const userErrors = payload?.userErrors ?? topLevelErrors(deleteJson);

  if (payload?.deletedId) {
    return { success: true };
  }
  return {
    success: false,
    error: userErrors.map((e: { message: string }) => e.message).join("; ") || "Order deletion failed.",
  };
}

export async function deleteDraftOrder(
  admin: { graphql: AdminGraphqlClient },
  draftOrderId: string,
): Promise<RollbackResult> {
  const json = await executeWithThrottleRetry(admin, DRAFT_ORDER_DELETE_MUTATION, {
    input: { id: draftOrderId },
  });
  const payload = json.data?.draftOrderDelete;
  const userErrors = payload?.userErrors ?? topLevelErrors(json);

  if (payload?.deletedId) {
    return { success: true };
  }
  return {
    success: false,
    error: userErrors.map((e: { message: string }) => e.message).join("; ") || "Draft order deletion failed.",
  };
}

async function waitForJob(admin: { graphql: AdminGraphqlClient }, jobId: string): Promise<void> {
  const MAX_ATTEMPTS = 5;
  const POLL_DELAY_MS = 500;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
    const response = await admin.graphql(JOB_STATUS_QUERY, { variables: { id: jobId } });
    const json = await response.json();
    if (json.data?.job?.done) return;
  }
}

function topLevelErrors(json: { errors?: { message: string }[] }): { field: string[] | null; message: string }[] {
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
