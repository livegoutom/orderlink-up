import { useState } from "react";
import { redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  DataTable,
  Checkbox,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ORDER_FIELDS } from "../lib/orderFields.server";
import { getImportJob, updateSuppressNotifications } from "../models/importJob.server";
import { getMatchStatusCounts } from "../models/importRow.server";
import { getOrderCreationCounts } from "../models/orderCreation.server";
import { getValidationCounts } from "../models/importValidation.server";
import { getRollbackCounts } from "../models/rollback.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }

  const columnMapping = job.columnMapping
    ? (JSON.parse(job.columnMapping) as Record<string, string>)
    : null;

  const fieldLabelByKey = new Map(ORDER_FIELDS.map((f) => [f.key, f.label]));
  const mappingRows = columnMapping
    ? Object.entries(columnMapping).map(([field, header]) => [
        fieldLabelByKey.get(field) ?? field,
        header,
      ])
    : [];

  const validationCounts =
    job.status === "validated" ? await getValidationCounts(job.id) : null;

  const matchCounts =
    job.status === "matching" || job.status === "matched"
      ? await getMatchStatusCounts(job.id)
      : null;

  const creationCounts =
    job.status === "creating" || job.status === "completed"
      ? await getOrderCreationCounts(job.id)
      : null;

  const rollbackCounts =
    job.status === "rolling_back" || job.status === "rolled_back"
      ? await getRollbackCounts(job.id)
      : null;

  return {
    job: {
      id: job.id,
      fileName: job.fileName,
      fileType: job.fileType,
      status: job.status,
      totalRows: job.totalRows,
      createdAt: job.createdAt,
      orderMode: job.orderMode as "draft" | "paid" | null,
      suppressNotifications: job.suppressNotifications,
    },
    mappingRows,
    validationCounts,
    matchCounts,
    creationCounts,
    rollbackCounts,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }

  const formData = await request.formData();
  const suppressNotifications = formData.get("suppressNotifications") === "true";

  await updateSuppressNotifications(session.shop, job.id, suppressNotifications);
  return redirect(`/app/imports/${job.id}/create`);
};

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "critical" | "attention"> = {
  uploaded: "info",
  mapped: "attention",
  validating: "attention",
  validated: "success",
  matching: "attention",
  matched: "success",
  creating: "attention",
  processing: "attention",
  completed: "success",
  rolling_back: "attention",
  failed: "critical",
  rolled_back: "warning",
};

export default function ImportSummary() {
  const { job, mappingRows, validationCounts, matchCounts, creationCounts, rollbackCounts } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [suppressNotifications, setSuppressNotifications] = useState(job.suppressNotifications);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  const handleCreateOrders = () => {
    const formData = new FormData();
    formData.append("suppressNotifications", suppressNotifications ? "true" : "false");
    submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title={job.fileName}>
        <button onClick={() => navigate("/app/imports")}>Back to imports</button>
      </TitleBar>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {job.fileName}
              </Text>
              <Badge tone={STATUS_TONE[job.status] ?? "info"}>{job.status}</Badge>
            </InlineStack>
            <InlineStack gap="600">
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">
                  File type
                </Text>
                <Text as="span" variant="bodyMd">
                  {job.fileType.toUpperCase()}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">
                  Rows
                </Text>
                <Text as="span" variant="bodyMd">
                  {job.totalRows}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">
                  Uploaded
                </Text>
                <Text as="span" variant="bodyMd">
                  {new Date(job.createdAt).toLocaleString()}
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {mappingRows.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Column mapping
              </Text>
              <DataTable
                columnContentTypes={["text", "text"]}
                headings={["Shopify field", "Source column"]}
                rows={mappingRows}
              />
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Next steps
            </Text>
            {job.status === "uploaded" && (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  This file was uploaded but its column mapping hasn't been
                  confirmed yet.
                </Text>
                <InlineStack>
                  <Button
                    variant="primary"
                    onClick={() => navigate(`/app/imports/${job.id}/mapping`)}
                  >
                    Continue to column mapping
                  </Button>
                </InlineStack>
              </>
            )}
            {job.status === "mapped" && (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Run a validation check to catch data problems (bad emails,
                  missing product identifiers, invalid quantities/prices)
                  before matching products or creating orders.
                </Text>
                <InlineStack>
                  <Button variant="primary" url={`/app/imports/${job.id}/validate`}>
                    Run validation check
                  </Button>
                </InlineStack>
              </>
            )}
            {job.status === "validated" && validationCounts && (
              <>
                <InlineStack gap="600">
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Valid rows
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {validationCounts.valid}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Rows with issues
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {validationCounts.error}
                    </Text>
                  </BlockStack>
                </InlineStack>
                <InlineStack gap="300">
                  <Button variant="primary" url={`/app/imports/${job.id}/matching`}>
                    Continue to matching
                  </Button>
                  <Button url={`/app/imports/${job.id}/validate`}>View validation report</Button>
                </InlineStack>
              </>
            )}
            {job.status === "matching" && (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Product matching is in progress.
                </Text>
                <InlineStack>
                  <Button variant="primary" url={`/app/imports/${job.id}/matching`}>
                    Resume matching
                  </Button>
                </InlineStack>
              </>
            )}
            {job.status === "matched" && matchCounts && (
              <>
                <InlineStack gap="600">
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Auto-matched
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {matchCounts.matched}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Custom line items
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {matchCounts.custom_line_item}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Skipped
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {matchCounts.skipped}
                    </Text>
                  </BlockStack>
                </InlineStack>

                <Text as="p" variant="bodyMd">
                  Creating as:{" "}
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {job.orderMode === "paid" ? "Paid historical orders" : "Draft orders"}
                  </Text>
                </Text>
                {job.orderMode === "paid" && (
                  <Checkbox
                    label="Suppress customer notifications and inventory changes (recommended for historical imports)"
                    checked={suppressNotifications}
                    onChange={setSuppressNotifications}
                  />
                )}
                <InlineStack>
                  <Button variant="primary" loading={isSubmitting} onClick={handleCreateOrders}>
                    Create orders
                  </Button>
                </InlineStack>
              </>
            )}
            {job.status === "creating" && (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Order creation is in progress.
                </Text>
                <InlineStack>
                  <Button variant="primary" url={`/app/imports/${job.id}/create`}>
                    Resume
                  </Button>
                </InlineStack>
              </>
            )}
            {job.status === "completed" && creationCounts && (
              <>
                <InlineStack gap="600">
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Imported
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {creationCounts.imported}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Errors
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {creationCounts.error}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Skipped
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {creationCounts.skipped}
                    </Text>
                  </BlockStack>
                </InlineStack>
                <InlineStack gap="300">
                  {creationCounts.error > 0 && (
                    <Button url={`/app/imports/${job.id}/create`}>Review failed orders</Button>
                  )}
                  {creationCounts.imported > 0 && (
                    <Button tone="critical" onClick={() => setRollbackModalOpen(true)}>
                      Rollback this import
                    </Button>
                  )}
                </InlineStack>
              </>
            )}
            {job.status === "rolling_back" && (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Rollback is in progress — removing the orders this import created from Shopify.
                </Text>
                <InlineStack>
                  <Button variant="primary" url={`/app/imports/${job.id}/rollback`}>
                    Resume rollback
                  </Button>
                </InlineStack>
              </>
            )}
            {job.status === "rolled_back" && rollbackCounts && (
              <>
                <InlineStack gap="600">
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Rolled back
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {rollbackCounts.rolled_back}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Errors
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {rollbackCounts.rollback_error}
                    </Text>
                  </BlockStack>
                </InlineStack>
                {rollbackCounts.rollback_error > 0 && (
                  <InlineStack>
                    <Button url={`/app/imports/${job.id}/rollback`}>Review failed rollbacks</Button>
                  </InlineStack>
                )}
              </>
            )}
            {![
              "uploaded",
              "mapped",
              "validated",
              "matching",
              "matched",
              "creating",
              "completed",
              "rolling_back",
              "rolled_back",
            ].includes(job.status) && (
              <Text as="p" variant="bodyMd" tone="subdued">
                This import is saved and ready for the next build phase.
              </Text>
            )}
          </BlockStack>
        </Card>

        <InlineStack>
          <Button onClick={() => navigate("/app/imports")}>Back to imports</Button>
        </InlineStack>
      </BlockStack>

      <Modal
        open={rollbackModalOpen}
        onClose={() => setRollbackModalOpen(false)}
        title="Rollback this import?"
        primaryAction={{
          content: "Permanently delete these orders",
          destructive: true,
          onAction: () => navigate(`/app/imports/${job.id}/rollback`),
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setRollbackModalOpen(false) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This will permanently delete every order this import created from Shopify. This
            action is irreversible — deleted orders cannot be recovered.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
