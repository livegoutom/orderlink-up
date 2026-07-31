import { useEffect, useRef, useState } from "react";
import { redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Button, Banner, ProgressBar, List } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { checkHasActivePayment, countLifetimeImportedOrders, FREE_ORDER_LIMIT } from "../models/billing.server";
import { logAccess } from "../models/accessLog.server";
import { getImportJob, markJobCreating } from "../models/importJob.server";
import {
  getErrorGroups,
  getNextPendingGroupKeys,
  getOrderCreationCounts,
  getRowsForGroups,
  markGroupError,
  markGroupImported,
  markGroupSkipped,
  prepareOrderGroups,
  retryGroup,
  type ErrorGroup,
  type OrderCreationCounts,
} from "../models/orderCreation.server";
import { buildOrderPayload } from "../lib/orderGrouping.server";
import { parseImportOptions } from "../lib/importOptions";
import { createDraftOrder, createPaidOrder, getShopCurrency } from "../lib/shopifyOrderCreate.server";

// 1 order per ~13s ≈ 4.6/min, safely under Shopify's ~5/min order-creation cap for dev/trial
// stores. A prior 2-per-13s pacing (~9.2/min) exceeded that cap and caused live "Too many
// attempts" failures - don't raise this without re-checking the real limit.
const BATCH_LIMIT = 1;
const BATCH_DELAY_MS = 13000;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }
  if (!job.orderMode || !job.columnMapping) {
    return redirect(`/app/imports/${job.id}`);
  }

  const counts = await getOrderCreationCounts(job.id);
  const errorGroups = await getErrorGroups(job.id);

  return {
    job: {
      id: job.id,
      fileName: job.fileName,
      status: job.status,
      totalRows: job.totalRows,
      orderMode: job.orderMode as "draft" | "paid",
    },
    counts,
    errorGroups,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }
  if (!job.orderMode || !job.columnMapping) {
    return { error: "This import isn't ready for order creation yet." };
  }

  const headers: string[] = JSON.parse(job.headers);
  const columnMapping: Record<string, string> = JSON.parse(job.columnMapping);
  const orderMode = job.orderMode as "draft" | "paid";

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "prepare") {
    const hasActivePayment = await checkHasActivePayment(admin, billing);
    if (!hasActivePayment) {
      const ordersUsed = await countLifetimeImportedOrders(session.shop);
      if (ordersUsed >= FREE_ORDER_LIMIT) {
        return {
          limitReached: true,
          error: `You've used all ${FREE_ORDER_LIMIT} free order imports. Upgrade to Unlimited Orders ($15/month) to keep importing.`,
        };
      }
    }

    await prepareOrderGroups(job.id, headers, columnMapping);
    await markJobCreating(session.shop, job.id);
    return { counts: await getOrderCreationCounts(job.id) };
  }

  if (intent === "processBatch") {
    const groupKeys = await getNextPendingGroupKeys(job.id, BATCH_LIMIT);

    if (groupKeys.length > 0) {
      const shopCurrency = await getShopCurrency(admin);
      const rowsByGroup = await getRowsForGroups(job.id, groupKeys);

      for (const groupKey of groupKeys) {
        const rows = rowsByGroup.get(groupKey) ?? [];
        const rowsForGrouping = rows.map((r) => ({
          id: r.id,
          cells: JSON.parse(r.rawData) as string[],
          matchStatus: r.matchStatus,
          matchedVariantId: r.matchedVariantId,
          matchedVariantTitle: r.matchedVariantTitle,
        }));

        const payload = buildOrderPayload(rowsForGrouping, headers, columnMapping, {
          orderMode,
          shopCurrency,
          importOptions: parseImportOptions(job.options, job.suppressNotifications),
        });

        if ("skip" in payload) {
          await markGroupSkipped(job.id, groupKey);
          continue;
        }
        if ("error" in payload) {
          await markGroupError(job.id, groupKey, payload.error);
          continue;
        }

        try {
          const result =
            "draftInput" in payload
              ? await createDraftOrder(admin, payload.draftInput)
              : await createPaidOrder(admin, payload.orderInput, payload.options);

          if (result.orderId) {
            await markGroupImported(job.id, groupKey, result.orderId);
            await logAccess(session.shop, "order_created", result.orderId);
          } else {
            const message = result.userErrors.map((e) => e.message).join("; ") || "Order creation failed.";
            await markGroupError(job.id, groupKey, message);
          }
        } catch (err) {
          await markGroupError(job.id, groupKey, err instanceof Error ? err.message : "Order creation failed.");
        }
      }
    }

    return { counts: await getOrderCreationCounts(job.id) };
  }

  if (intent === "retryGroup") {
    const groupKey = formData.get("groupKey");
    if (typeof groupKey === "string") {
      await retryGroup(job.id, groupKey);
    }
    return { counts: await getOrderCreationCounts(job.id) };
  }

  return { error: "Unknown action." };
};

export default function ImportCreateOrders() {
  const { job, counts: initialCounts, errorGroups } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const prepareFetcher = useFetcher<{
    counts?: OrderCreationCounts;
    error?: string;
    limitReached?: boolean;
  }>();
  const processFetcher = useFetcher<{ counts?: OrderCreationCounts; error?: string }>();
  const retryFetcher = useFetcher<{ counts?: OrderCreationCounts; error?: string }>();

  const [counts, setCounts] = useState<OrderCreationCounts>(initialCounts);
  const preparedRef = useRef(false);
  const prevPendingRef = useRef(initialCounts.pending);

  // One-time, idempotent: ensure rows are grouped and job is marked "creating".
  useEffect(() => {
    if (!preparedRef.current) {
      preparedRef.current = true;
      const formData = new FormData();
      formData.append("intent", "prepare");
      prepareFetcher.submit(formData, { method: "post" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (prepareFetcher.data?.counts) {
      setCounts(prepareFetcher.data.counts);
    }
  }, [prepareFetcher.data]);

  useEffect(() => {
    if (processFetcher.data?.counts) {
      setCounts(processFetcher.data.counts);
    }
  }, [processFetcher.data]);

  useEffect(() => {
    if (retryFetcher.data?.counts) {
      setCounts(retryFetcher.data.counts);
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryFetcher.data]);

  // Paced batch loop: only starts once "prepare" has completed successfully.
  useEffect(() => {
    if (!prepareFetcher.data || prepareFetcher.data.error) return;
    if (counts.pending === 0) return;
    if (processFetcher.state !== "idle") return;

    const timer = setTimeout(() => {
      const formData = new FormData();
      formData.append("intent", "processBatch");
      processFetcher.submit(formData, { method: "post" });
    }, BATCH_DELAY_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.pending, processFetcher.state, prepareFetcher.data]);

  useEffect(() => {
    if (prevPendingRef.current > 0 && counts.pending === 0) {
      revalidator.revalidate();
    }
    prevPendingRef.current = counts.pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.pending]);

  const isInProgress = counts.pending > 0;
  const rowsProcessed = job.totalRows - counts.pending;
  const progress = job.totalRows > 0 ? Math.round((rowsProcessed / job.totalRows) * 100) : 100;

  const handleRetry = (groupKey: string) => {
    const formData = new FormData();
    formData.append("intent", "retryGroup");
    formData.append("groupKey", groupKey);
    retryFetcher.submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title={job.orderMode === "draft" ? "Creating draft orders" : "Creating orders"} />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {job.fileName}
            </Text>
            {isInProgress ? (
              <BlockStack gap="200">
                <ProgressBar progress={progress} />
                <Text as="p" tone="subdued">
                  Creating {job.orderMode === "draft" ? "draft orders" : "orders"}… paced to respect Shopify's order-creation rate limits, this may take a while for larger imports.
                </Text>
              </BlockStack>
            ) : (
              <InlineStack gap="600">
                <Metric label="Imported" value={counts.imported} tone="success" />
                <Metric label="Errors" value={counts.error} tone={counts.error > 0 ? "critical" : "subdued"} />
                <Metric label="Skipped" value={counts.skipped} />
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {!isInProgress && counts.error > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {errorGroups.length} order{errorGroups.length === 1 ? "" : "s"} failed
              </Text>
              <List>
                {errorGroups.map((group: ErrorGroup) => (
                  <List.Item key={group.groupKey}>
                    <InlineStack align="space-between" blockAlign="center" gap="400">
                      <Text as="span" variant="bodyMd">
                        Row{group.rowNumbers.length > 1 ? "s" : ""} {group.rowNumbers.join(", ")}: {group.message}
                      </Text>
                      <Button size="slim" onClick={() => handleRetry(group.groupKey)}>
                        Retry
                      </Button>
                    </InlineStack>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </Card>
        )}

        {!isInProgress && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Done
              </Text>
              <InlineStack>
                <Button variant="primary" onClick={() => navigate(`/app/imports/${job.id}`)}>
                  Back to import summary
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {(prepareFetcher.data?.error || processFetcher.data?.error) && (
          <Banner tone="critical">
            <BlockStack gap="200">
              <Text as="p">{prepareFetcher.data?.error ?? processFetcher.data?.error}</Text>
              {prepareFetcher.data?.limitReached && (
                <InlineStack>
                  <Button variant="primary" onClick={() => navigate("/app/billing")}>
                    Upgrade — from $15/month
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "critical" | "subdued";
}) {
  return (
    <BlockStack gap="050">
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="span" variant="headingLg" tone={tone}>
        {value}
      </Text>
    </BlockStack>
  );
}
