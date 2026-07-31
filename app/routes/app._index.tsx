import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  DataTable,
  EmptyState,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listImportJobs } from "../models/importJob.server";
import {
  checkHasActivePayment,
  countLifetimeImportedOrders,
  countLifetimeImportedRows,
  FREE_ORDER_LIMIT,
} from "../models/billing.server";
import { purgeStaleImportJobs } from "../models/accessLog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);

  // Opportunistic retention cleanup - no scheduler/cron infra exists, so this runs on a normal
  // page load instead. Global (not scoped to this shop) since it's cheap and shop-agnostic.
  // Never allowed to break the dashboard if it fails.
  purgeStaleImportJobs().catch((err) => console.error("Retention cleanup failed:", err));

  const [jobs, ordersUsed, rowsImported, hasActivePayment] = await Promise.all([
    listImportJobs(session.shop),
    countLifetimeImportedOrders(session.shop),
    countLifetimeImportedRows(session.shop),
    checkHasActivePayment(admin, billing),
  ]);

  return {
    recentJobs: jobs.slice(0, 5).map((j) => ({
      id: j.id,
      fileName: j.fileName,
      createdAt: j.createdAt,
      orderMode: j.orderMode,
      totalRows: j.totalRows,
      status: j.status,
    })),
    totalImports: jobs.length,
    ordersUsed,
    rowsImported,
    hasActivePayment,
    limit: FREE_ORDER_LIMIT,
  };
};

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "critical" | "attention"> = {
  uploaded: "info",
  mapped: "attention",
  validating: "attention",
  validated: "success",
  matching: "attention",
  matched: "success",
  creating: "attention",
  completed: "success",
  rolling_back: "attention",
  failed: "critical",
  rolled_back: "warning",
};

export default function Home() {
  const { recentJobs, totalImports, ordersUsed, rowsImported, hasActivePayment, limit } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const planProgress = Math.min(100, Math.round((ordersUsed / limit) * 100));

  return (
    <Page>
      <TitleBar title="OrderLink Up" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Quick actions
            </Text>
            <InlineStack gap="300">
              <Button variant="primary" onClick={() => navigate("/app/imports")}>
                Import orders
              </Button>
              <Button onClick={() => navigate("/app/migrate")}>Migrate from another platform</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Recent activity
                  </Text>
                  <Button variant="plain" onClick={() => navigate("/app/imports")}>
                    View all imports
                  </Button>
                </InlineStack>

                <InlineStack gap="600">
                  <Stat label="Total imports" value={totalImports} />
                  <Stat label="Orders imported" value={ordersUsed} />
                  <Stat label="Rows imported" value={rowsImported} />
                </InlineStack>

                {recentJobs.length === 0 ? (
                  <EmptyState
                    heading="No imports yet"
                    image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
                  >
                    <Text as="p">Start your first import to see activity here.</Text>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text"]}
                    headings={["Filename", "Date", "Mode", "Rows", "Status"]}
                    rows={recentJobs.map((job) => [
                      <a
                        key={job.id}
                        href={`/app/imports/${job.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/app/imports/${job.id}`);
                        }}
                      >
                        {job.fileName}
                      </a>,
                      new Date(job.createdAt).toLocaleDateString(),
                      job.orderMode === "paid" ? "Paid" : job.orderMode === "draft" ? "Draft" : "—",
                      job.totalRows,
                      <Badge key={`${job.id}-status`} tone={STATUS_TONE[job.status] ?? "info"}>
                        {job.status}
                      </Badge>,
                    ])}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Your plan
                  </Text>
                  <Badge tone={hasActivePayment ? "success" : "info"}>
                    {hasActivePayment ? "Unlimited Orders" : "Free"}
                  </Badge>
                </InlineStack>

                {hasActivePayment ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Unlimited order imports.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      {ordersUsed} / {limit} free orders used.
                    </Text>
                    <ProgressBar progress={planProgress} tone={ordersUsed >= limit ? "critical" : "primary"} />
                  </BlockStack>
                )}

                <InlineStack>
                  <Button onClick={() => navigate("/app/billing")}>
                    {hasActivePayment ? "Manage plan" : "Upgrade — from $15/month"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <BlockStack gap="050">
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="span" variant="headingLg">
        {value}
      </Text>
    </BlockStack>
  );
}
