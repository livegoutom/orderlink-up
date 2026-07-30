import { useEffect } from "react";
import { redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Button, List } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getImportJob } from "../models/importJob.server";
import {
  getValidationCounts,
  getValidationErrorSummary,
  runValidation,
  skipErrorRows,
  type ValidationErrorGroup,
} from "../models/importValidation.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }
  if (!job.columnMapping) {
    return redirect(`/app/imports/${job.id}/mapping`);
  }

  const counts = await getValidationCounts(job.id);
  const errorSummary = await getValidationErrorSummary(job.id);

  return {
    job: { id: job.id, fileName: job.fileName, status: job.status, totalRows: job.totalRows },
    counts,
    errorSummary,
    hasRun: job.status !== "mapped",
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }
  if (!job.columnMapping) {
    return { error: "This import hasn't been mapped yet." };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "run") {
    const headers: string[] = JSON.parse(job.headers);
    const columnMapping: Record<string, string> = JSON.parse(job.columnMapping);
    await runValidation(job.id, headers, columnMapping);
    return { ran: true };
  }

  if (intent === "skipErrorRows") {
    await skipErrorRows(job.id);
    return { skipped: true };
  }

  return { error: "Unknown action." };
};

export default function ImportValidate() {
  const { job, counts, errorSummary, hasRun } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const runFetcher = useFetcher<typeof action>();
  const skipFetcher = useFetcher<typeof action>();

  const isRunning = runFetcher.state !== "idle";
  const isSkipping = skipFetcher.state !== "idle";

  useEffect(() => {
    if (runFetcher.data && "ran" in runFetcher.data) {
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetcher.data]);

  useEffect(() => {
    if (skipFetcher.data && "skipped" in skipFetcher.data) {
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipFetcher.data]);

  const handleRun = () => {
    const formData = new FormData();
    formData.append("intent", "run");
    runFetcher.submit(formData, { method: "post" });
  };

  const handleSkip = () => {
    const formData = new FormData();
    formData.append("intent", "skipErrorRows");
    skipFetcher.submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="Validate import" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {job.fileName}
            </Text>
            {!hasRun ? (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Check each row for common problems (bad emails, missing product identifiers,
                  invalid quantities/prices/addresses) before matching products or creating
                  orders.
                </Text>
                <InlineStack>
                  <Button variant="primary" loading={isRunning} onClick={handleRun}>
                    Run validation check
                  </Button>
                </InlineStack>
              </>
            ) : (
              <InlineStack gap="600">
                <Metric label="Valid" value={counts.valid} tone="success" />
                <Metric label="Errors" value={counts.error} tone={counts.error > 0 ? "critical" : "subdued"} />
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {hasRun && counts.error > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Issues found
                </Text>
                <Button onClick={handleSkip} loading={isSkipping}>
                  Skip all invalid rows
                </Button>
              </InlineStack>
              <List>
                {errorSummary.map((group: ValidationErrorGroup) => (
                  <List.Item key={group.message}>
                    {group.rowNumbers.length} row{group.rowNumbers.length === 1 ? "" : "s"}:{" "}
                    {group.message} (rows {group.rowNumbers.join(", ")})
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </Card>
        )}

        {hasRun && (
          <InlineStack gap="300">
            <Button variant="primary" url={`/app/imports/${job.id}/matching`}>
              Continue to matching
            </Button>
            <Button url={`/app/imports/${job.id}/mapping`}>Fix mapping</Button>
          </InlineStack>
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
