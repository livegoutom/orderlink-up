import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  DataTable,
  EmptyState,
  Badge,
  Text,
  BlockStack,
  Button,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { deleteImportJob, listImportJobs } from "../models/importJob.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobs = await listImportJobs(session.shop);
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      fileName: j.fileName,
      createdAt: j.createdAt,
      orderMode: j.orderMode,
      totalRows: j.totalRows,
      status: j.status,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const jobId = formData.get("jobId");
    if (typeof jobId === "string") {
      await deleteImportJob(session.shop, jobId);
    }
    return { deleted: true };
  }

  return { error: "Unknown action." };
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

// Jobs whose orders may still be live in Shopify — removing history for these loses the
// ability to roll those orders back through OrderLink Up, so the confirmation warns explicitly.
const STATUSES_WITH_LIVE_ORDERS = new Set(["completed", "rolling_back"]);

export default function ActivityPage() {
  const { jobs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ deleted?: boolean; error?: string }>();
  const [pendingDelete, setPendingDelete] = useState<{ id: string; fileName: string; hasLiveOrders: boolean } | null>(
    null,
  );

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    const formData = new FormData();
    formData.append("intent", "delete");
    formData.append("jobId", pendingDelete.id);
    fetcher.submit(formData, { method: "post" });
    setPendingDelete(null);
  };

  return (
    <Page>
      <TitleBar title="Activity" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              All imports
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Every import you've run, in one place. Removing an import only deletes its record
              from OrderLink Up — it never touches orders already created in Shopify.
            </Text>

            {jobs.length === 0 ? (
              <EmptyState
                heading="No activity yet"
                image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
              >
                <Text as="p">Imports you run will show up here.</Text>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                headings={["Filename", "Date", "Mode", "Rows", "Status", ""]}
                rows={jobs.map((job) => [
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
                  new Date(job.createdAt).toLocaleString(),
                  job.orderMode === "paid" ? "Paid" : job.orderMode === "draft" ? "Draft" : "—",
                  job.totalRows,
                  <Badge key={`${job.id}-status`} tone={STATUS_TONE[job.status] ?? "info"}>
                    {job.status}
                  </Badge>,
                  <Button
                    key={`${job.id}-remove`}
                    variant="plain"
                    tone="critical"
                    onClick={() =>
                      setPendingDelete({
                        id: job.id,
                        fileName: job.fileName,
                        hasLiveOrders: STATUSES_WITH_LIVE_ORDERS.has(job.status),
                      })
                    }
                  >
                    Remove
                  </Button>,
                ])}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Remove this import from your history?"
        primaryAction={{
          content: "Remove",
          destructive: true,
          loading: fetcher.state !== "idle",
          onAction: handleConfirmDelete,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setPendingDelete(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              This permanently deletes "{pendingDelete?.fileName}" and all its row data from
              OrderLink Up. This can't be undone.
            </Text>
            {pendingDelete?.hasLiveOrders && (
              <Text as="p" tone="critical" fontWeight="semibold">
                This import created orders in Shopify that are still there. Once you remove this
                history, you'll no longer be able to roll those orders back through OrderLink Up —
                you'd need to cancel or delete them manually in Shopify Admin.
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
