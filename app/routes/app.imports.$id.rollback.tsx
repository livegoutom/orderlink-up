import { useEffect, useRef, useState } from "react";
import { redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Button, Banner, ProgressBar, List } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getImportJob, markJobRollingBack } from "../models/importJob.server";
import {
  getNextImportedOrderIds,
  getRollbackCounts,
  getRollbackErrorGroups,
  markOrderRollbackError,
  markOrderRolledBack,
  retryRollbackOrder,
  type RollbackCounts,
  type RollbackErrorGroup,
} from "../models/rollback.server";
import { cancelAndDeleteOrder, deleteDraftOrder } from "../lib/shopifyOrderRollback.server";

// Same conservative pacing as order creation - deletion mutations hit the same rate-limited API.
const BATCH_LIMIT = 2;
const BATCH_DELAY_MS = 13000;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }
  if (!["completed", "rolling_back", "rolled_back"].includes(job.status) || !job.orderMode) {
    return redirect(`/app/imports/${job.id}`);
  }

  const counts = await getRollbackCounts(job.id);
  const errorGroups = await getRollbackErrorGroups(job.id);

  return {
    job: {
      id: job.id,
      fileName: job.fileName,
      status: job.status,
      orderMode: job.orderMode as "draft" | "paid",
    },
    counts,
    errorGroups,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }
  if (!job.orderMode) {
    return { error: "This import has no orders to roll back." };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "start") {
    await markJobRollingBack(session.shop, job.id);
    return { counts: await getRollbackCounts(job.id) };
  }

  if (intent === "processBatch") {
    const orderIds = await getNextImportedOrderIds(job.id, BATCH_LIMIT);

    for (const orderId of orderIds) {
      try {
        const result =
          job.orderMode === "draft"
            ? await deleteDraftOrder(admin, orderId)
            : await cancelAndDeleteOrder(admin, orderId);

        if (result.success) {
          await markOrderRolledBack(job.id, orderId);
        } else {
          await markOrderRollbackError(job.id, orderId, result.error ?? "Rollback failed.");
        }
      } catch (err) {
        await markOrderRollbackError(job.id, orderId, err instanceof Error ? err.message : "Rollback failed.");
      }
    }

    return { counts: await getRollbackCounts(job.id) };
  }

  if (intent === "retryOrder") {
    const shopifyOrderId = formData.get("shopifyOrderId");
    if (typeof shopifyOrderId === "string") {
      await retryRollbackOrder(job.id, shopifyOrderId);
    }
    return { counts: await getRollbackCounts(job.id) };
  }

  return { error: "Unknown action." };
};

export default function ImportRollback() {
  const { job, counts: initialCounts, errorGroups } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const startFetcher = useFetcher<{ counts?: RollbackCounts; error?: string }>();
  const processFetcher = useFetcher<{ counts?: RollbackCounts; error?: string }>();
  const retryFetcher = useFetcher<{ counts?: RollbackCounts; error?: string }>();

  const [counts, setCounts] = useState<RollbackCounts>(initialCounts);
  const startedRef = useRef(false);
  const prevImportedRef = useRef(initialCounts.imported);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      const formData = new FormData();
      formData.append("intent", "start");
      startFetcher.submit(formData, { method: "post" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (startFetcher.data?.counts) setCounts(startFetcher.data.counts);
  }, [startFetcher.data]);

  useEffect(() => {
    if (processFetcher.data?.counts) setCounts(processFetcher.data.counts);
  }, [processFetcher.data]);

  useEffect(() => {
    if (retryFetcher.data?.counts) {
      setCounts(retryFetcher.data.counts);
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryFetcher.data]);

  useEffect(() => {
    if (!startFetcher.data) return;
    if (counts.imported === 0) return;
    if (processFetcher.state !== "idle") return;

    const timer = setTimeout(() => {
      const formData = new FormData();
      formData.append("intent", "processBatch");
      processFetcher.submit(formData, { method: "post" });
    }, BATCH_DELAY_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.imported, processFetcher.state, startFetcher.data]);

  useEffect(() => {
    if (prevImportedRef.current > 0 && counts.imported === 0) {
      revalidator.revalidate();
    }
    prevImportedRef.current = counts.imported;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.imported]);

  const isInProgress = counts.imported > 0;

  const handleRetry = (shopifyOrderId: string) => {
    const formData = new FormData();
    formData.append("intent", "retryOrder");
    formData.append("shopifyOrderId", shopifyOrderId);
    retryFetcher.submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="Rolling back import" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {job.fileName}
            </Text>
            {isInProgress ? (
              <BlockStack gap="200">
                <ProgressBar progress={counts.rolled_back > 0 || counts.rollback_error > 0 ? 50 : 10} />
                <Text as="p" tone="subdued">
                  Deleting {job.orderMode === "draft" ? "draft orders" : "orders"} from Shopify… this is
                  paced to respect rate limits and may take a while for larger imports.
                </Text>
              </BlockStack>
            ) : (
              <InlineStack gap="600">
                <Metric label="Rolled back" value={counts.rolled_back} tone="success" />
                <Metric label="Errors" value={counts.rollback_error} tone={counts.rollback_error > 0 ? "critical" : "subdued"} />
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {!isInProgress && counts.rollback_error > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {errorGroups.length} order{errorGroups.length === 1 ? "" : "s"} couldn't be removed
              </Text>
              <List>
                {errorGroups.map((group: RollbackErrorGroup) => (
                  <List.Item key={group.shopifyOrderId}>
                    <InlineStack align="space-between" blockAlign="center" gap="400">
                      <Text as="span" variant="bodyMd">
                        {group.message}
                      </Text>
                      <Button size="slim" onClick={() => handleRetry(group.shopifyOrderId)}>
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

        {(startFetcher.data?.error || processFetcher.data?.error) && (
          <Banner tone="critical">{startFetcher.data?.error ?? processFetcher.data?.error}</Banner>
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
