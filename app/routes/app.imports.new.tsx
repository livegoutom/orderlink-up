import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DropZone,
  Text,
  BlockStack,
  Banner,
  Button,
  InlineStack,
  Select,
  DataTable,
  ProgressBar,
  Badge,
  List,
  Checkbox,
  Modal,
  TextField,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate, UNLIMITED_PLANS, billingPlans } from "../shopify.server";
import { countLifetimeImportedOrders, FREE_ORDER_LIMIT } from "../models/billing.server";
import { parseUploadedFile } from "../lib/fileParser.server";
import { ORDER_FIELDS, type OrderFieldSection } from "../lib/orderFields.server";
import {
  createImportJobWithRows,
  getImportJob,
  markJobCreating,
  markJobMatching,
  setImportJobMapping,
  setImportJobOptions,
} from "../models/importJob.server";
import { createImportTemplate, listImportTemplates } from "../models/importTemplate.server";
import { runValidation, getValidationErrorSummary } from "../models/importValidation.server";
import {
  applyMatchResults,
  bulkResolveUnmatched,
  getMatchStatusCounts,
  getPendingRowsBatch,
  type MatchStatusCounts,
} from "../models/importRow.server";
import { extractRowIdentifiers, matchRowsBatch } from "../lib/productMatcher.server";
import {
  countOrderGroups,
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
import {
  DEFAULT_ORDER_IMPORT_OPTIONS,
  parseImportOptions,
  type OrderImportOptions,
} from "../lib/importOptions";
import { createDraftOrder, createPaidOrder, getShopCurrency } from "../lib/shopifyOrderCreate.server";
import { getPlatformPreset } from "../lib/platformPresets";
import { detectMappingForPlatform } from "../lib/platformPresets.server";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MATCH_BATCH_LIMIT = 25;
// 1 order per ~13s ≈ 4.6/min, safely under Shopify's ~5/min order-creation cap for dev/trial
// stores. A prior 2-per-13s pacing (~9.2/min) exceeded that cap and caused live "Too many
// attempts" failures - don't raise this without re-checking the real limit.
const CREATE_BATCH_LIMIT = 1;
const CREATE_BATCH_DELAY_MS = 13000;
const PREVIEW_ROWS = 10;

function parseOrderMode(value: string | null | undefined): "draft" | "paid" {
  return value === "paid" ? "paid" : "draft";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const templates = await listImportTemplates(session.shop);
  const platformId = url.searchParams.get("platform");
  const platform = getPlatformPreset(platformId);
  return {
    orderMode: parseOrderMode(url.searchParams.get("mode")),
    platform: platform ? { id: platform.id, name: platform.name } : null,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      mapping: JSON.parse(t.mapping) as Record<string, string>,
    })),
    fields: ORDER_FIELDS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const contentType = request.headers.get("content-type") ?? "";

  // ---- upload (multipart) ----
  if (contentType.includes("multipart/form-data")) {
    const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: MAX_UPLOAD_BYTES });
    let formData;
    try {
      formData = await unstable_parseMultipartFormData(request, uploadHandler);
    } catch {
      return { intent: "upload", error: "Upload failed. The file may be too large (max 20MB)." };
    }

    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return { intent: "upload", error: "Please choose a CSV or Excel file to upload." };
    }

    const fileName = file.name;
    const fileType = fileName.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
    const buffer = Buffer.from(await file.arrayBuffer());

    let parsed;
    try {
      parsed = await parseUploadedFile(buffer, fileName);
    } catch (error) {
      return {
        intent: "upload",
        error: error instanceof Error ? error.message : "Could not parse file.",
      };
    }
    if (parsed.headers.length === 0) {
      return { intent: "upload", error: "No columns were found in this file." };
    }
    if (parsed.rows.length === 0) {
      return { intent: "upload", error: "This file has no data rows." };
    }

    const orderMode = parseOrderMode(formData.get("mode") as string | null);
    const platformId = formData.get("platform") as string | null;
    const job = await createImportJobWithRows(session.shop, fileName, fileType, parsed, orderMode);

    return {
      intent: "upload",
      jobId: job.id,
      fileName,
      headers: parsed.headers,
      suggestions: detectMappingForPlatform(parsed.headers, platformId),
      previewRows: parsed.rows.slice(0, PREVIEW_ROWS),
      totalRows: parsed.rows.length,
    };
  }

  // ---- everything else (urlencoded) ----
  const formData = await request.formData();
  const intent = formData.get("intent");
  const jobId = formData.get("jobId");
  if (typeof jobId !== "string") return { intent, error: "Missing import id." };

  const job = await getImportJob(session.shop, jobId);
  if (!job) return { intent, error: "Import not found." };

  const headers: string[] = JSON.parse(job.headers);

  if (intent === "saveTemplate") {
    const name = formData.get("templateName");
    if (typeof name !== "string" || name.trim() === "") {
      return { intent, error: "Please enter a name for the mapping template." };
    }
    const mapping = readMappingFromForm(formData, headers);
    if ("error" in mapping) return { intent, error: mapping.error };
    await createImportTemplate(session.shop, name.trim(), mapping.columnMapping);
    return { intent, saved: true };
  }

  if (intent === "start") {
    const mapping = readMappingFromForm(formData, headers);
    if ("error" in mapping) return { intent, error: mapping.error };

    const optionsJson = formData.get("options");
    await setImportJobMapping(session.shop, job.id, mapping.columnMapping);
    if (typeof optionsJson === "string") {
      await setImportJobOptions(session.shop, job.id, optionsJson);
    }
    await runValidation(job.id, headers, mapping.columnMapping);

    return {
      intent,
      started: true,
      warnings: await getValidationErrorSummary(job.id),
      matchCounts: await getMatchStatusCounts(job.id),
    };
  }

  if (intent === "matchBatch") {
    if (!job.columnMapping) return { intent, error: "Mapping not saved yet." };
    await markJobMatching(session.shop, job.id);
    const columnMapping: Record<string, string> = JSON.parse(job.columnMapping);
    const importOptions = parseImportOptions(job.options, job.suppressNotifications);
    const pendingRows = await getPendingRowsBatch(job.id, MATCH_BATCH_LIMIT);

    if (pendingRows.length > 0) {
      const candidates = pendingRows.map((row) => ({
        id: row.id,
        identifiers: extractRowIdentifiers(JSON.parse(row.rawData), headers, columnMapping),
      }));
      const matchResults = await matchRowsBatch(admin, candidates, {
        lookupByTitle: importOptions.lookupByTitle,
      });
      await applyMatchResults(
        job.id,
        candidates.map((c) => ({ rowId: c.id, result: matchResults.get(c.id)! })),
      );
    }

    return { intent, matchCounts: await getMatchStatusCounts(job.id) };
  }

  if (intent === "resolveUnmatched") {
    const importOptions = parseImportOptions(job.options, job.suppressNotifications);
    await bulkResolveUnmatched(
      job.id,
      importOptions.unmatchedFallback === "skip" ? "skipped" : "custom_line_item",
    );
    return { intent, matchCounts: await getMatchStatusCounts(job.id) };
  }

  if (intent === "prepareOrders") {
    if (!job.columnMapping) return { intent, error: "Mapping not saved yet." };

    const { hasActivePayment } = await billing.check({ plans: billingPlans(...UNLIMITED_PLANS), isTest: true });
    if (!hasActivePayment) {
      const ordersUsed = await countLifetimeImportedOrders(session.shop);
      if (ordersUsed >= FREE_ORDER_LIMIT) {
        return {
          intent,
          limitReached: true,
          error: `You've used all ${FREE_ORDER_LIMIT} free order imports. Upgrade to Unlimited Orders ($15/month) to keep importing.`,
        };
      }
    }

    const columnMapping: Record<string, string> = JSON.parse(job.columnMapping);
    await prepareOrderGroups(job.id, headers, columnMapping);
    await markJobCreating(session.shop, job.id);
    return {
      intent,
      orderCount: await countOrderGroups(job.id),
      creationCounts: await getOrderCreationCounts(job.id),
    };
  }

  if (intent === "createBatch") {
    if (!job.columnMapping || !job.orderMode) return { intent, error: "Import not ready." };
    const columnMapping: Record<string, string> = JSON.parse(job.columnMapping);
    const orderMode = job.orderMode as "draft" | "paid";
    const importOptions = parseImportOptions(job.options, job.suppressNotifications);
    const groupKeys = await getNextPendingGroupKeys(job.id, CREATE_BATCH_LIMIT);

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
          importOptions,
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
          } else {
            const message =
              result.userErrors.map((e) => e.message).join("; ") || "Order creation failed.";
            await markGroupError(job.id, groupKey, message);
          }
        } catch (err) {
          await markGroupError(
            job.id,
            groupKey,
            err instanceof Error ? err.message : "Order creation failed.",
          );
        }
      }
    }

    return {
      intent,
      creationCounts: await getOrderCreationCounts(job.id),
      errorGroups: await getErrorGroups(job.id),
    };
  }

  if (intent === "retryGroup") {
    const groupKey = formData.get("groupKey");
    if (typeof groupKey === "string") {
      await retryGroup(job.id, groupKey);
    }
    return {
      intent: "createBatch",
      creationCounts: await getOrderCreationCounts(job.id),
      errorGroups: await getErrorGroups(job.id),
    };
  }

  return { intent, error: "Unknown action." };
};

function readMappingFromForm(
  formData: FormData,
  headers: string[],
): { columnMapping: Record<string, string> } | { error: string } {
  const headerToField: Record<string, string> = {};
  const usedFields = new Set<string>();
  const duplicates = new Set<string>();

  for (const header of headers) {
    const value = formData.get(`mapping::${header}`);
    if (typeof value === "string" && value !== "") {
      if (usedFields.has(value)) duplicates.add(value);
      usedFields.add(value);
      headerToField[header] = value;
    }
  }

  if (duplicates.size > 0) {
    const labels = ORDER_FIELDS.filter((f) => duplicates.has(f.key)).map((f) => f.label);
    return { error: `Each Shopify field can only be mapped once. Duplicate mapping for: ${labels.join(", ")}.` };
  }
  if (!usedFields.has("email")) {
    return { error: "You must map a column to Email before importing." };
  }
  const hasLineItemIdentifier = ["sku", "barcode", "variantId", "productTitle"].some((key) =>
    usedFields.has(key),
  );
  if (!hasLineItemIdentifier) {
    return {
      error: "You must map at least one line item identifier: SKU, Barcode, Variant ID, or Product Title.",
    };
  }

  const columnMapping: Record<string, string> = {};
  for (const [header, field] of Object.entries(headerToField)) {
    columnMapping[field] = header;
  }
  return { columnMapping };
}

type Phase = "idle" | "ready" | "starting" | "matching" | "resolving" | "preparing" | "creating" | "done";

interface UploadResult {
  jobId: string;
  fileName: string;
  headers: string[];
  suggestions: Record<string, string | null>;
  previewRows: string[][];
  totalRows: number;
}

export default function NewImport() {
  const { orderMode, platform, templates, fields } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadFetcher = useFetcher<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runFetcher = useFetcher<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchFetcher = useFetcher<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createFetcher = useFetcher<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const templateFetcher = useFetcher<any>();

  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [options, setOptions] = useState<OrderImportOptions>({ ...DEFAULT_ORDER_IMPORT_OPTIONS });
  const [phase, setPhase] = useState<Phase>("idle");
  const [warnings, setWarnings] = useState<{ message: string; rowNumbers: number[] }[]>([]);
  const [matchCounts, setMatchCounts] = useState<MatchStatusCounts | null>(null);
  const [orderCount, setOrderCount] = useState<number | null>(null);
  const [creationCounts, setCreationCounts] = useState<OrderCreationCounts | null>(null);
  const [errorGroups, setErrorGroups] = useState<ErrorGroup[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  // ---- upload handling ----
  const handleDrop = useCallback(
    (_drop: File[], accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", orderMode);
      if (platform) formData.append("platform", platform.id);
      uploadFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
    },
    [orderMode, platform, uploadFetcher],
  );

  useEffect(() => {
    const data = uploadFetcher.data;
    if (!data || data.intent !== "upload") return;
    if (data.error) {
      setPageError(data.error);
      return;
    }
    setPageError(null);
    setUpload(data as UploadResult);
    const initial: Record<string, string> = {};
    for (const header of data.headers as string[]) {
      initial[header] = (data.suggestions as Record<string, string | null>)[header] ?? "";
    }
    setMapping(initial);
    setPhase("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFetcher.data]);

  const handleClear = () => {
    setUpload(null);
    setMapping({});
    setPhase("idle");
    setWarnings([]);
    setMatchCounts(null);
    setOrderCount(null);
    setCreationCounts(null);
    setErrorGroups([]);
    setPreviewRowIndex(0);
    setPageError(null);
  };

  // ---- mapping helpers ----
  const sections = useMemo(() => {
    const grouped = new Map<OrderFieldSection, typeof fields>();
    for (const field of fields) {
      const list = grouped.get(field.section) ?? [];
      list.push(field);
      grouped.set(field.section, list);
    }
    return Array.from(grouped.entries());
  }, [fields]);

  const selectOptions = useMemo(
    () => [
      { label: "Do not import", value: "" },
      ...sections.map(([section, sectionFields]) => ({
        title: section,
        options: sectionFields.map((f) => ({ label: f.label, value: f.key })),
      })),
    ],
    [sections],
  );

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId || !upload) return;
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    const headerToField: Record<string, string> = {};
    for (const [field, header] of Object.entries(template.mapping)) {
      if (header) headerToField[header] = field;
    }
    const next: Record<string, string> = {};
    for (const header of upload.headers) {
      next[header] = headerToField[header] ?? "";
    }
    setMapping(next);
  };

  const handleAutoMap = () => {
    if (!upload) return;
    const next: Record<string, string> = {};
    for (const header of upload.headers) {
      next[header] = upload.suggestions[header] ?? "";
    }
    setMapping(next);
  };

  const handleReset = () => {
    if (!upload) return;
    const next: Record<string, string> = {};
    for (const header of upload.headers) next[header] = "";
    setMapping(next);
  };

  const appendMappingFields = (formData: FormData) => {
    if (!upload) return;
    formData.append("jobId", upload.jobId);
    for (const header of upload.headers) {
      formData.append(`mapping::${header}`, mapping[header] ?? "");
    }
  };

  const handleSaveTemplate = () => {
    if (!upload) return;
    const formData = new FormData();
    formData.append("intent", "saveTemplate");
    formData.append("templateName", templateName);
    appendMappingFields(formData);
    templateFetcher.submit(formData, { method: "post" });
    setSaveModalOpen(false);
  };

  // ---- run: start -> matching loop -> resolve -> prepare -> creating loop ----
  const handleCreateOrders = () => {
    if (!upload) return;
    setPageError(null);
    const formData = new FormData();
    formData.append("intent", "start");
    formData.append("options", JSON.stringify(options));
    appendMappingFields(formData);
    runFetcher.submit(formData, { method: "post" });
    setPhase("starting");
  };

  useEffect(() => {
    const data = runFetcher.data;
    if (!data || !upload) return;
    if (data.error) {
      setPageError(data.error);
      setLimitReached(Boolean(data.limitReached));
      setPhase("ready");
      return;
    }
    if (data.intent === "start" && data.started) {
      setWarnings(data.warnings ?? []);
      setMatchCounts(data.matchCounts);
      setPhase("matching");
    }
    if (data.intent === "resolveUnmatched") {
      setMatchCounts(data.matchCounts);
      setPhase("preparing");
      const formData = new FormData();
      formData.append("intent", "prepareOrders");
      formData.append("jobId", upload.jobId);
      runFetcher.submit(formData, { method: "post" });
    }
    if (data.intent === "prepareOrders") {
      setOrderCount(data.orderCount);
      setCreationCounts(data.creationCounts);
      setPhase("creating");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetcher.data]);

  // matching loop
  useEffect(() => {
    if (phase !== "matching" || !upload || !matchCounts) return;
    if (matchFetcher.state !== "idle" || runFetcher.state !== "idle") return;

    if (matchCounts.pending > 0) {
      const formData = new FormData();
      formData.append("intent", "matchBatch");
      formData.append("jobId", upload.jobId);
      matchFetcher.submit(formData, { method: "post" });
    } else if (matchCounts.unmatched > 0) {
      setPhase("resolving");
      const formData = new FormData();
      formData.append("intent", "resolveUnmatched");
      formData.append("jobId", upload.jobId);
      runFetcher.submit(formData, { method: "post" });
    } else {
      setPhase("preparing");
      const formData = new FormData();
      formData.append("intent", "prepareOrders");
      formData.append("jobId", upload.jobId);
      runFetcher.submit(formData, { method: "post" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, matchCounts, matchFetcher.state, runFetcher.state]);

  useEffect(() => {
    const data = matchFetcher.data;
    if (!data) return;
    if (data.error) {
      setPageError(data.error);
      setPhase("ready");
      return;
    }
    if (data.matchCounts) setMatchCounts(data.matchCounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchFetcher.data]);

  // creation loop (paced)
  useEffect(() => {
    if (phase !== "creating" || !upload || !creationCounts) return;
    if (createFetcher.state !== "idle") return;

    if (creationCounts.pending === 0) {
      setPhase("done");
      return;
    }
    const timer = setTimeout(() => {
      const formData = new FormData();
      formData.append("intent", "createBatch");
      formData.append("jobId", upload.jobId);
      createFetcher.submit(formData, { method: "post" });
    }, CREATE_BATCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, creationCounts, createFetcher.state]);

  useEffect(() => {
    const data = createFetcher.data;
    if (!data) return;
    if (data.error) {
      setPageError(data.error);
      return;
    }
    if (data.creationCounts) setCreationCounts(data.creationCounts);
    if (data.errorGroups) setErrorGroups(data.errorGroups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFetcher.data]);

  const handleRetry = (groupKey: string) => {
    if (!upload) return;
    const formData = new FormData();
    formData.append("intent", "retryGroup");
    formData.append("jobId", upload.jobId);
    formData.append("groupKey", groupKey);
    createFetcher.submit(formData, { method: "post" });
    setPhase("creating");
  };

  // ---- derived UI values ----
  const isUploading = uploadFetcher.state !== "idle";
  const isRunning = ["starting", "matching", "resolving", "preparing", "creating"].includes(phase);
  const lookupProgress =
    !upload || !matchCounts
      ? 0
      : Math.round(((upload.totalRows - matchCounts.pending) / Math.max(1, upload.totalRows)) * 100);
  const creationProgress =
    !upload || !creationCounts
      ? 0
      : Math.round(
          ((upload.totalRows - creationCounts.pending) / Math.max(1, upload.totalRows)) * 100,
        );
  const previewRow = upload?.previewRows[previewRowIndex];

  const baseTitle = orderMode === "paid" ? "Completed orders import" : "Draft orders import";
  const title = platform ? `Migrate from ${platform.name}` : baseTitle;

  return (
    <Page fullWidth>
      <TitleBar title={title}>
        <button onClick={() => navigate("/app/imports")}>Back to imports</button>
      </TitleBar>
      <Layout>
        {/* ============ LEFT COLUMN ============ */}
        <Layout.Section>
          <BlockStack gap="400">
            {pageError && (
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text as="p">{pageError}</Text>
                  {limitReached && (
                    <InlineStack>
                      <Button variant="primary" onClick={() => navigate("/app/billing")}>
                        Upgrade — from $15/month
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </Banner>
            )}

            {platform && (
              <Banner tone="info">
                Using {platform.name} column presets — review the suggested mapping below before
                continuing. Real exports vary, so double-check anything that looks off.
              </Banner>
            )}

            {/* Upload file */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Upload file
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {upload
                        ? `File: ${upload.fileName}`
                        : "Upload a CSV or Excel file with your order data."}
                    </Text>
                  </BlockStack>
                  {upload && (
                    <Button tone="critical" onClick={handleClear} disabled={isRunning}>
                      Clear
                    </Button>
                  )}
                </InlineStack>
                {!upload ? (
                  <DropZone accept=".csv,.xlsx,.xls" type="file" onDrop={handleDrop} allowMultiple={false}>
                    <DropZone.FileUpload
                      actionTitle={isUploading ? "Uploading..." : "Upload or Drop file here"}
                      actionHint="Accepted file types: .csv, .xlsx"
                    />
                  </DropZone>
                ) : (
                  <BlockStack gap="200">
                    <div style={{ overflowX: "auto" }}>
                      <DataTable
                        columnContentTypes={upload.headers.map(() => "text")}
                        headings={upload.headers}
                        rows={upload.previewRows}
                        truncate
                      />
                    </div>
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      Showing first {upload.previewRows.length} rows of data
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* Map headers */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Map headers
                  </Text>
                  <InlineStack gap="200">
                    <Button onClick={handleReset} disabled={!upload || isRunning}>
                      Reset
                    </Button>
                    <Button variant="primary" onClick={handleAutoMap} disabled={!upload || isRunning}>
                      Auto map
                    </Button>
                    <Button onClick={() => setSaveModalOpen(true)} disabled={!upload || isRunning}>
                      Save mapping
                    </Button>
                  </InlineStack>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Map the headers on your file to their respective fields on the order.
                </Text>
                <Select
                  label="Load saved mapping"
                  options={[
                    { label: "Select a mapping...", value: "" },
                    ...templates.map((t) => ({ label: t.name, value: t.id })),
                  ]}
                  value={selectedTemplateId}
                  onChange={applyTemplate}
                  disabled={!upload || isRunning}
                />
                {!upload ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Upload a spreadsheet to map headers.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Button
                        size="slim"
                        disabled={previewRowIndex === 0}
                        onClick={() => setPreviewRowIndex((i) => Math.max(0, i - 1))}
                      >
                        Previous
                      </Button>
                      <Text as="span" variant="bodySm">
                        Row {previewRowIndex + 1}
                      </Text>
                      <Button
                        size="slim"
                        disabled={previewRowIndex >= upload.previewRows.length - 1}
                        onClick={() =>
                          setPreviewRowIndex((i) => Math.min(upload.previewRows.length - 1, i + 1))
                        }
                      >
                        Next
                      </Button>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Adjust the row that is being previewed
                      </Text>
                    </InlineStack>
                    <Divider />
                    <InlineStack gap="400" blockAlign="center">
                      <div style={{ width: "24%" }}>
                        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                          COLUMN NAME
                        </Text>
                      </div>
                      <div style={{ width: "22%" }}>
                        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                          CELL VALUE
                        </Text>
                      </div>
                      <div style={{ flex: 1 }}>
                        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                          MAPPING
                        </Text>
                      </div>
                      <div style={{ width: 90 }}>
                        <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                          STATUS
                        </Text>
                      </div>
                    </InlineStack>
                    {upload.headers.map((header, colIndex) => (
                      <BlockStack key={header} gap="100">
                        <Divider />
                        <InlineStack gap="400" blockAlign="center" wrap={false}>
                          <div style={{ width: "24%" }}>
                            <Text as="span" variant="bodyMd">
                              {header}
                            </Text>
                          </div>
                          <div style={{ width: "22%" }}>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {previewRow?.[colIndex] || "—"}
                            </Text>
                          </div>
                          <div style={{ flex: 1 }}>
                            <Select
                              label={`Map ${header}`}
                              labelHidden
                              options={selectOptions}
                              value={mapping[header] ?? ""}
                              onChange={(value) =>
                                setMapping((prev) => ({ ...prev, [header]: value }))
                              }
                              disabled={isRunning}
                            />
                          </div>
                          <div style={{ width: 90 }}>
                            {mapping[header] ? (
                              <Badge tone="success">Mapped</Badge>
                            ) : (
                              <Badge tone="attention">Skipped</Badge>
                            )}
                          </div>
                        </InlineStack>
                      </BlockStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* Transform and lookup progress */}
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Transform and lookup progress
                </Text>
                <ProgressBar
                  progress={phase === "idle" || phase === "ready" ? 0 : lookupProgress}
                  tone="primary"
                />
              </BlockStack>
            </Card>

            {/* Order results */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Order results
                </Text>
                {orderCount === null ? (
                  <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                    No orders to preview
                  </Text>
                ) : (
                  <InlineStack gap="600">
                    <Metric label="Orders" value={orderCount} />
                    {creationCounts && (
                      <>
                        <Metric label="Imported" value={creationCounts.imported} tone="success" />
                        <Metric
                          label="Errors"
                          value={creationCounts.error}
                          tone={creationCounts.error > 0 ? "critical" : "subdued"}
                        />
                        <Metric label="Skipped" value={creationCounts.skipped} />
                      </>
                    )}
                  </InlineStack>
                )}
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Order creation progress
                  </Text>
                  <ProgressBar progress={creationCounts ? creationProgress : 0} tone="primary" />
                </BlockStack>
                {phase === "done" && errorGroups.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      {errorGroups.length} order{errorGroups.length === 1 ? "" : "s"} failed
                    </Text>
                    <List>
                      {errorGroups.map((group) => (
                        <List.Item key={group.groupKey}>
                          <InlineStack align="space-between" blockAlign="center" gap="400">
                            <Text as="span" variant="bodyMd">
                              Row{group.rowNumbers.length > 1 ? "s" : ""} {group.rowNumbers.join(", ")}:{" "}
                              {group.message}
                            </Text>
                            <Button size="slim" onClick={() => handleRetry(group.groupKey)}>
                              Retry
                            </Button>
                          </InlineStack>
                        </List.Item>
                      ))}
                    </List>
                  </BlockStack>
                )}
                <InlineStack>
                  <Button
                    variant="primary"
                    disabled={!upload || isRunning || phase === "done"}
                    loading={isRunning}
                    onClick={handleCreateOrders}
                  >
                    Create orders
                  </Button>
                </InlineStack>
                {phase === "done" && (
                  <Banner tone={errorGroups.length > 0 ? "warning" : "success"}>
                    Import finished — {creationCounts?.imported ?? 0} row
                    {(creationCounts?.imported ?? 0) === 1 ? "" : "s"} imported across {orderCount}{" "}
                    order{(orderCount ?? 0) === 1 ? "" : "s"}. Check the Orders section in your
                    Shopify admin.
                  </Banner>
                )}
              </BlockStack>
            </Card>

            {/* Warnings */}
            {warnings.length > 0 && (
              <Banner tone="warning" title="Warnings">
                <List>
                  {warnings.map((w) => (
                    <List.Item key={w.message}>
                      {w.rowNumbers.length} row{w.rowNumbers.length === 1 ? "" : "s"}: {w.message}{" "}
                      (rows {w.rowNumbers.join(", ")})
                    </List.Item>
                  ))}
                </List>
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>

        {/* ============ RIGHT SIDEBAR ============ */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Example files */}
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Example files
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Download a sample file to see the expected format.
                </Text>
                <InlineStack>
                  <Button onClick={() => downloadFile("/sample-completed-orders-import.csv")}>
                    Comprehensive orders
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* File summary */}
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  File summary
                </Text>
                <DataTable
                  columnContentTypes={["text", "numeric", "text", "numeric"]}
                  headings={["Filename", "Lines", "Orders", "Fields"]}
                  rows={[
                    [
                      upload?.fileName ?? "No file",
                      upload?.totalRows ?? "No data",
                      orderCount ?? "No orders",
                      upload?.headers.length ?? "No fields",
                    ],
                  ]}
                />
              </BlockStack>
            </Card>

            {/* Order options */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Order options
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Select the options below to customize how orders are created.
                </Text>

                <OptionSection title="Product mapping">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Products are always looked up by variant SKU, barcode, or variant ID first.
                  </Text>
                  <Checkbox
                    label="Also lookup products by product Title"
                    helpText="If no SKU/barcode match is found, fall back to matching by product title. If the product has more than one variant, the first variant will be used."
                    checked={options.lookupByTitle}
                    onChange={(v) => setOptions((o) => ({ ...o, lookupByTitle: v }))}
                    disabled={isRunning}
                  />
                  <Select
                    label="Unmatched products"
                    options={[
                      { label: "Create as custom line item", value: "custom_line_item" },
                      { label: "Skip the row", value: "skip" },
                    ]}
                    value={options.unmatchedFallback}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        unmatchedFallback: v === "skip" ? "skip" : "custom_line_item",
                      }))
                    }
                    helpText="What to do with rows whose product can't be found."
                    disabled={isRunning}
                  />
                </OptionSection>

                {orderMode === "paid" && (
                  <OptionSection title="Customer">
                    <Checkbox
                      label="Upsert customers"
                      helpText="Create or update customers based on the email provided, and link the order to them."
                      checked={options.upsertCustomers}
                      onChange={(v) => setOptions((o) => ({ ...o, upsertCustomers: v }))}
                      disabled={isRunning}
                    />
                  </OptionSection>
                )}

                {orderMode === "paid" && (
                  <OptionSection title="Email notifications">
                    <Checkbox
                      label="Send order confirmation email"
                      helpText="If enabled, the customer receives an order confirmation email."
                      checked={options.sendOrderConfirmation}
                      onChange={(v) => setOptions((o) => ({ ...o, sendOrderConfirmation: v }))}
                      disabled={isRunning}
                    />
                    <Checkbox
                      label="Send order fulfillment email"
                      helpText="If enabled, the customer receives a shipping confirmation email."
                      checked={options.sendFulfillmentEmail}
                      onChange={(v) => setOptions((o) => ({ ...o, sendFulfillmentEmail: v }))}
                      disabled={isRunning}
                    />
                  </OptionSection>
                )}

                <OptionSection title="Addresses">
                  <Checkbox
                    label="Use billing address for shipping address"
                    helpText="If enabled, the billing address columns are used for the shipping address."
                    checked={options.useBillingAsShipping}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        useBillingAsShipping: v,
                        useShippingAsBilling: v ? false : o.useShippingAsBilling,
                      }))
                    }
                    disabled={isRunning}
                  />
                  <Checkbox
                    label="Use shipping address for billing address"
                    helpText="If enabled, the shipping address columns are used for the billing address."
                    checked={options.useShippingAsBilling}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        useShippingAsBilling: v,
                        useBillingAsShipping: v ? false : o.useBillingAsShipping,
                      }))
                    }
                    disabled={isRunning}
                  />
                </OptionSection>

                {orderMode === "paid" && (
                  <OptionSection title="Inventory">
                    <Select
                      label="Inventory behaviour"
                      options={[
                        { label: "Do not deduct inventory", value: "BYPASS" },
                        { label: "Deduct inventory (obey policies)", value: "DECREMENT_OBEYING_POLICY" },
                        { label: "Deduct inventory (ignore policies)", value: "DECREMENT_IGNORING_POLICY" },
                      ]}
                      value={options.inventoryBehaviour}
                      onChange={(v) =>
                        setOptions((o) => ({
                          ...o,
                          inventoryBehaviour: v as OrderImportOptions["inventoryBehaviour"],
                        }))
                      }
                      helpText="Select how inventory should be handled when an order is created."
                      disabled={isRunning}
                    />
                  </OptionSection>
                )}

                <OptionSection title="General">
                  <Checkbox
                    label="Skip empty quantities"
                    helpText="If enabled, rows with empty or 0 quantities are skipped."
                    checked={options.skipEmptyQuantities}
                    onChange={(v) => setOptions((o) => ({ ...o, skipEmptyQuantities: v }))}
                    disabled={isRunning}
                  />
                  {orderMode === "paid" && (
                    <Checkbox
                      label="Use Order Number as order name"
                      helpText="If enabled, the mapped Order Number is used as the Shopify order name."
                      checked={options.useOrderNumberAsName}
                      onChange={(v) => setOptions((o) => ({ ...o, useOrderNumberAsName: v }))}
                      disabled={isRunning}
                    />
                  )}
                </OptionSection>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save mapping"
        primaryAction={{ content: "Save", onAction: handleSaveTemplate }}
        secondaryActions={[{ content: "Cancel", onAction: () => setSaveModalOpen(false) }]}
      >
        <Modal.Section>
          <TextField
            label="Mapping name"
            autoComplete="off"
            value={templateName}
            onChange={setTemplateName}
            placeholder="e.g. WooCommerce export"
          />
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// Plain-anchor download that bypasses the app's client-side router (Polaris Button
// url links render through Remix <Link>, which intercepts clicks for SPA navigation
// and never triggers a real browser download).
function downloadFile(path: string) {
  const anchor = document.createElement("a");
  anchor.href = path;
  anchor.download = path.split("/").pop() ?? "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function OptionSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <BlockStack gap="200">
      <Divider />
      <Text as="h3" variant="headingSm">
        {title}
      </Text>
      {children}
    </BlockStack>
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
