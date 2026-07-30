import { useEffect, useMemo, useRef, useState } from "react";
import { redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  ProgressBar,
  Autocomplete,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getImportJob, markJobMatching } from "../models/importJob.server";
import {
  applyMatchResults,
  bulkResolveUnmatched,
  getMatchStatusCounts,
  getPendingRowsBatch,
  getUnmatchedRows,
  resolveRow,
  type MatchStatusCounts,
} from "../models/importRow.server";
import { extractRowIdentifiers, matchRowsBatch } from "../lib/productMatcher.server";

const BATCH_LIMIT = 25;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }
  if (!job.columnMapping) {
    return redirect(`/app/imports/${job.id}/mapping`);
  }

  const counts = await getMatchStatusCounts(job.id);
  const unmatchedRows = await getUnmatchedRows(job.id);
  const headers: string[] = JSON.parse(job.headers);
  const columnMapping: Record<string, string> = JSON.parse(job.columnMapping);

  return {
    job: { id: job.id, fileName: job.fileName, status: job.status, totalRows: job.totalRows },
    counts,
    headers,
    columnMapping,
    unmatchedRows: unmatchedRows.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      cells: JSON.parse(row.rawData) as string[],
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }
  if (!job.columnMapping) {
    return { error: "This import hasn't been mapped yet." };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "processBatch") {
    await markJobMatching(session.shop, job.id);
    const headers: string[] = JSON.parse(job.headers);
    const columnMapping: Record<string, string> = JSON.parse(job.columnMapping);
    const pendingRows = await getPendingRowsBatch(job.id, BATCH_LIMIT);

    if (pendingRows.length > 0) {
      const candidates = pendingRows.map((row) => ({
        id: row.id,
        identifiers: extractRowIdentifiers(JSON.parse(row.rawData), headers, columnMapping),
      }));
      const matchResults = await matchRowsBatch(admin, candidates);
      await applyMatchResults(
        job.id,
        candidates.map((c) => ({ rowId: c.id, result: matchResults.get(c.id)! })),
      );
    }

    return { counts: await getMatchStatusCounts(job.id) };
  }

  if (intent === "resolveRow") {
    const rowId = formData.get("rowId");
    const resolution = formData.get("resolution");
    if (typeof rowId !== "string" || typeof resolution !== "string") {
      return { error: "Invalid request." };
    }

    if (resolution === "manual") {
      const manualVariantId = formData.get("manualVariantId");
      const manualVariantTitle = formData.get("manualVariantTitle");
      if (typeof manualVariantId !== "string" || typeof manualVariantTitle !== "string") {
        return { error: "Please pick a product before confirming." };
      }
      await resolveRow(job.id, rowId, "manual", { id: manualVariantId, title: manualVariantTitle });
    } else if (resolution === "custom_line_item" || resolution === "skipped") {
      await resolveRow(job.id, rowId, resolution);
    } else {
      return { error: "Invalid resolution." };
    }

    return { counts: await getMatchStatusCounts(job.id) };
  }

  if (intent === "bulkResolve") {
    const resolution = formData.get("resolution");
    if (resolution === "custom_line_item" || resolution === "skipped") {
      await bulkResolveUnmatched(job.id, resolution);
    }
    return { counts: await getMatchStatusCounts(job.id) };
  }

  return { error: "Unknown action." };
};

export default function ImportMatching() {
  const { job, counts: initialCounts, headers, columnMapping, unmatchedRows } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const processFetcher = useFetcher<{ counts?: MatchStatusCounts; error?: string }>();
  const actionFetcher = useFetcher<{ counts?: MatchStatusCounts; error?: string }>();

  const [counts, setCounts] = useState<MatchStatusCounts>(initialCounts);
  const prevPendingRef = useRef(initialCounts.pending);

  useEffect(() => {
    setCounts(initialCounts);
    prevPendingRef.current = initialCounts.pending;
  }, [initialCounts]);

  useEffect(() => {
    if (processFetcher.data?.counts) {
      setCounts(processFetcher.data.counts);
    }
  }, [processFetcher.data]);

  useEffect(() => {
    if (actionFetcher.data?.counts) {
      setCounts(actionFetcher.data.counts);
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFetcher.data]);

  // Drive the batch loop: whenever there are pending rows and no request in flight, submit the next batch.
  useEffect(() => {
    if (counts.pending > 0 && processFetcher.state === "idle") {
      const formData = new FormData();
      formData.append("intent", "processBatch");
      processFetcher.submit(formData, { method: "post" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.pending, processFetcher.state]);

  useEffect(() => {
    if (prevPendingRef.current > 0 && counts.pending === 0) {
      revalidator.revalidate();
    }
    prevPendingRef.current = counts.pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.pending]);

  const isMatchingInProgress = counts.pending > 0;
  const isFullyResolved = counts.pending === 0 && counts.unmatched === 0;
  const rowsProcessed = job.totalRows - counts.pending;
  const progress = job.totalRows > 0 ? Math.round((rowsProcessed / job.totalRows) * 100) : 100;

  const bulkResolve = (resolution: "custom_line_item" | "skipped") => {
    const formData = new FormData();
    formData.append("intent", "bulkResolve");
    formData.append("resolution", resolution);
    actionFetcher.submit(formData, { method: "post" });
  };

  const resolve = (
    rowId: string,
    resolution: "custom_line_item" | "skipped" | "manual",
    manual?: { id: string; title: string },
  ) => {
    const formData = new FormData();
    formData.append("intent", "resolveRow");
    formData.append("rowId", rowId);
    formData.append("resolution", resolution);
    if (manual) {
      formData.append("manualVariantId", manual.id);
      formData.append("manualVariantTitle", manual.title);
    }
    actionFetcher.submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="Match products" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {job.fileName}
            </Text>
            {isMatchingInProgress ? (
              <BlockStack gap="200">
                <ProgressBar progress={progress} />
                <Text as="p" tone="subdued">
                  Matching products… {rowsProcessed}/{job.totalRows}
                </Text>
              </BlockStack>
            ) : (
              <InlineStack gap="600">
                <Metric label="Auto-matched" value={counts.matched} tone="success" />
                <Metric label="Needs review" value={counts.unmatched} tone={counts.unmatched > 0 ? "critical" : "subdued"} />
                <Metric label="Custom line items" value={counts.custom_line_item} />
                <Metric label="Skipped" value={counts.skipped} />
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {!isMatchingInProgress && counts.unmatched > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  {counts.unmatched} row{counts.unmatched === 1 ? "" : "s"} need review
                </Text>
                <InlineStack gap="200">
                  <Button onClick={() => bulkResolve("custom_line_item")}>Create custom line items for all</Button>
                  <Button onClick={() => bulkResolve("skipped")}>Skip all</Button>
                </InlineStack>
              </InlineStack>
              <BlockStack gap="400">
                {unmatchedRows.map((row) => (
                  <UnmatchedRow
                    key={row.id}
                    row={row}
                    headers={headers}
                    columnMapping={columnMapping}
                    onResolve={resolve}
                  />
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {isFullyResolved && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                All rows resolved
              </Text>
              <Text as="p" tone="subdued">
                Every row now has a matched variant, a custom line item, or is marked to skip.
              </Text>
              <InlineStack>
                <Button variant="primary" onClick={() => navigate(`/app/imports/${job.id}`)}>
                  Continue
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {actionFetcher.data?.error && <Banner tone="critical">{actionFetcher.data.error}</Banner>}
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

function UnmatchedRow({
  row,
  headers,
  columnMapping,
  onResolve,
}: {
  row: { id: string; rowNumber: number; cells: string[] };
  headers: string[];
  columnMapping: Record<string, string>;
  onResolve: (
    rowId: string,
    resolution: "custom_line_item" | "skipped" | "manual",
    manual?: { id: string; title: string },
  ) => void;
}) {
  const identifierLabel = useMemo(() => {
    const parts: string[] = [];
    for (const field of ["sku", "barcode", "variantId", "productTitle"] as const) {
      const header = columnMapping[field];
      if (!header) continue;
      const index = headers.indexOf(header);
      const value = index >= 0 ? row.cells[index] : "";
      if (value) parts.push(`${field}: ${value}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "No identifiers mapped";
  }, [row, headers, columnMapping]);

  const [showSearch, setShowSearch] = useState(false);

  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            Row {row.rowNumber}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {identifierLabel}
          </Text>
        </BlockStack>
        <InlineStack gap="200">
          <Button size="slim" onClick={() => onResolve(row.id, "custom_line_item")}>
            Custom line item
          </Button>
          <Button size="slim" onClick={() => onResolve(row.id, "skipped")}>
            Skip
          </Button>
          <Button size="slim" onClick={() => setShowSearch((s) => !s)}>
            {showSearch ? "Cancel search" : "Search product"}
          </Button>
        </InlineStack>
      </InlineStack>
      {showSearch && (
        <VariantSearchPicker
          onPick={(variant) => {
            onResolve(row.id, "manual", {
              id: variant.id,
              title: `${variant.productTitle} - ${variant.title}`,
            });
            setShowSearch(false);
          }}
        />
      )}
    </BlockStack>
  );
}

interface SearchVariant {
  id: string;
  title: string;
  sku: string | null;
  productTitle: string;
}

function VariantSearchPicker({ onPick }: { onPick: (variant: SearchVariant) => void }) {
  const fetcher = useFetcher<{ variants: SearchVariant[] }>();
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      if (inputValue.trim().length >= 2) {
        fetcher.load(`/app/api/variant-search?q=${encodeURIComponent(inputValue.trim())}`);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  const variants = fetcher.data?.variants ?? [];
  const options = variants.map((v) => ({
    value: v.id,
    label: `${v.productTitle} - ${v.title}${v.sku ? ` (${v.sku})` : ""}`,
  }));

  const textField = (
    <Autocomplete.TextField
      onChange={setInputValue}
      label="Search products"
      labelHidden
      value={inputValue}
      placeholder="Search by product name or SKU"
      autoComplete="off"
    />
  );

  return (
    <Autocomplete
      options={options}
      selected={[]}
      onSelect={(picked) => {
        const variant = variants.find((v) => v.id === picked[0]);
        if (variant) onPick(variant);
      }}
      textField={textField}
      loading={fetcher.state === "loading"}
    />
  );
}
