import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  DataTable,
  EmptyState,
  Badge,
  Text,
  InlineGrid,
  BlockStack,
  InlineStack,
  List,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listImportJobs } from "../models/importJob.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobs = await listImportJobs(session.shop);
  return { jobs };
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

export default function ImportsIndex() {
  const { jobs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page>
      <TitleBar title="Import orders" />
      <BlockStack gap="400">
        <Text as="p" variant="bodyMd" tone="subdued">
          Each import workflow has its own strengths. Pick the one that fits how you want these
          orders to land in Shopify.
        </Text>

        <InlineGrid columns={2} gap="400">
          <WorkflowCard
            title="Completed orders import"
            recommended
            description="Import orders as completed, paid historical records with the original order date preserved. Best for store migrations and bulk historical imports."
            bullets={[
              "Product matching by SKU, barcode, or variant ID",
              "Dry-run validation before you commit to anything",
              "Notifications and inventory changes suppressed by default",
              "Original order dates preserved",
              "One-click rollback if something's wrong",
            ]}
            onOpen={() => navigate("/app/imports/new?mode=paid")}
            sampleFileUrl="/sample-completed-orders-import.csv"
            sampleFileName="sample-completed-orders-import.csv"
          />
          <WorkflowCard
            title="Draft orders import"
            description="Create draft orders from your CSV so you can review them before they become real orders."
            bullets={[
              "Same product matching and validation as completed orders",
              "Drafts never notify customers or touch inventory until completed",
              "Good for reviewing bulk uploads before committing",
              "One-click rollback if something's wrong",
            ]}
            onOpen={() => navigate("/app/imports/new?mode=draft")}
          />
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Recent imports
            </Text>
            {jobs.length === 0 ? (
              <EmptyState
                heading="No imports yet"
                image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
              >
                <Text as="p">Pick a workflow above to bring historical orders into this store.</Text>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "numeric", "text"]}
                headings={["File", "Uploaded", "Rows", "Status"]}
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
                  job.totalRows,
                  <Badge key={`${job.id}-status`} tone={STATUS_TONE[job.status] ?? "info"}>
                    {job.status}
                  </Badge>,
                ])}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function WorkflowCard({
  title,
  description,
  bullets,
  recommended,
  onOpen,
  sampleFileUrl,
  sampleFileName,
}: {
  title: string;
  description: string;
  bullets: string[];
  recommended?: boolean;
  onOpen: () => void;
  sampleFileUrl?: string;
  sampleFileName?: string;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          {recommended && <Badge tone="success">Recommended</Badge>}
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">
          {description}
        </Text>
        <List>
          {bullets.map((bullet) => (
            <List.Item key={bullet}>{bullet}</List.Item>
          ))}
        </List>
        <InlineStack gap="300">
          <Button variant="primary" onClick={onOpen}>
            Open importer
          </Button>
          {sampleFileUrl && (
            <Button
              onClick={() => {
                // Plain-anchor download; Polaris url links go through the client-side
                // router, which swallows the download attribute.
                const anchor = document.createElement("a");
                anchor.href = sampleFileUrl;
                anchor.download = sampleFileName ?? "";
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
              }}
            >
              Download example CSV
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
