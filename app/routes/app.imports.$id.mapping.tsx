import { useMemo, useState } from "react";
import { redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Select,
  Checkbox,
  TextField,
  Banner,
  Button,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ORDER_FIELDS, autoDetectMapping, type OrderFieldSection } from "../lib/orderFields.server";
import { getImportJob, getImportJobPreviewRows, setImportJobMapping } from "../models/importJob.server";
import { createImportTemplate, listImportTemplates } from "../models/importTemplate.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }

  const previewRows = await getImportJobPreviewRows(job.id, 5);
  const templates = await listImportTemplates(session.shop);

  const headers: string[] = JSON.parse(job.headers);
  const suggestions = autoDetectMapping(headers);

  return {
    job: {
      id: job.id,
      fileName: job.fileName,
      totalRows: job.totalRows,
      status: job.status,
    },
    headers,
    suggestions,
    previewRows: previewRows.map((row) => ({
      rowNumber: row.rowNumber,
      cells: JSON.parse(row.rawData) as string[],
    })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      mapping: JSON.parse(t.mapping) as Record<string, string | null>,
    })),
    fields: ORDER_FIELDS,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await getImportJob(session.shop, params.id!);
  if (!job) {
    throw new Response("Import not found", { status: 404 });
  }

  const formData = await request.formData();
  const headers: string[] = JSON.parse(job.headers);

  const headerToField: Record<string, string> = {};
  const usedFields = new Set<string>();
  const duplicates = new Set<string>();

  for (const header of headers) {
    const value = formData.get(`mapping::${header}`);
    if (typeof value === "string" && value !== "") {
      if (usedFields.has(value)) {
        duplicates.add(value);
      }
      usedFields.add(value);
      headerToField[header] = value;
    }
  }

  if (duplicates.size > 0) {
    const fieldLabels = ORDER_FIELDS.filter((f) => duplicates.has(f.key)).map((f) => f.label);
    return {
      error: `Each Shopify field can only be mapped once. Duplicate mapping for: ${fieldLabels.join(", ")}.`,
    };
  }

  if (!usedFields.has("email")) {
    return { error: "You must map a column to Email before continuing." };
  }

  const hasLineItemIdentifier = ["sku", "barcode", "variantId", "productTitle"].some((key) =>
    usedFields.has(key),
  );
  if (!hasLineItemIdentifier) {
    return {
      error: "You must map at least one line item identifier: SKU, Barcode, Variant ID, or Product Title.",
    };
  }

  // Store as { targetField: sourceHeaderName }
  const columnMapping: Record<string, string> = {};
  for (const [header, field] of Object.entries(headerToField)) {
    columnMapping[field] = header;
  }

  const saveAsTemplate = formData.get("saveAsTemplate") === "true";
  const templateName = formData.get("templateName");

  let templateId: string | undefined;
  if (saveAsTemplate) {
    if (typeof templateName !== "string" || templateName.trim() === "") {
      return { error: "Please enter a name for the mapping template." };
    }
    const template = await createImportTemplate(session.shop, templateName.trim(), columnMapping);
    templateId = template.id;
  }

  await setImportJobMapping(session.shop, job.id, columnMapping, templateId);

  return redirect(`/app/imports/${job.id}`);
};

export default function ImportMapping() {
  const { job, headers, suggestions, previewRows, templates, fields } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();

  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const header of headers) {
      initial[header] = suggestions[header] ?? "";
    }
    return initial;
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const isSubmitting = navigation.state === "submitting";

  const sections = useMemo(() => {
    const grouped = new Map<OrderFieldSection, typeof fields>();
    for (const field of fields) {
      const list = grouped.get(field.section) ?? [];
      list.push(field);
      grouped.set(field.section, list);
    }
    return Array.from(grouped.entries());
  }, [fields]);

  const selectOptions = useMemo(() => {
    return [
      { label: "Do not import", value: "" },
      ...sections.map(([section, sectionFields]) => ({
        title: section,
        options: sectionFields.map((f) => ({ label: f.label, value: f.key })),
      })),
    ];
  }, [sections]);

  const fieldLabelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of fields) map.set(f.key, f.label);
    return map;
  }, [fields]);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;

    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

    // template.mapping is { targetField: sourceHeaderName } -> invert to header -> field
    const headerToField: Record<string, string> = {};
    for (const [field, header] of Object.entries(template.mapping)) {
      if (header) headerToField[header] = field;
    }

    const next: Record<string, string> = {};
    for (const header of headers) {
      next[header] = headerToField[header] ?? "";
    }
    setMapping(next);
  };

  const handleConfirm = () => {
    const formData = new FormData();
    for (const header of headers) {
      formData.append(`mapping::${header}`, mapping[header] ?? "");
    }
    formData.append("saveAsTemplate", saveAsTemplate ? "true" : "false");
    formData.append("templateName", templateName);
    submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="Map columns" />
      <BlockStack gap="400">
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              {job.fileName}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {job.totalRows} rows detected. Map each column to a Shopify
              order field, or leave it as &quot;Do not import&quot;.
            </Text>
          </BlockStack>
        </Card>

        {templates.length > 0 && (
          <Card>
            <Select
              label="Load a saved mapping template"
              options={[{ label: "Select a template...", value: "" }, ...templates.map((t) => ({ label: t.name, value: t.id }))]}
              value={selectedTemplateId}
              onChange={handleTemplateChange}
            />
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            {headers.map((header, index) => {
              const sampleValue = previewRows[0]?.cells[index] ?? "";
              return (
                <InlineStack key={header} align="space-between" blockAlign="center" gap="400" wrap={false}>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {header}
                    </Text>
                    {sampleValue && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        e.g. &quot;{sampleValue}&quot;
                      </Text>
                    )}
                  </BlockStack>
                  <div style={{ minWidth: 260 }}>
                    <Select
                      label={`Map ${header}`}
                      labelHidden
                      options={selectOptions}
                      value={mapping[header] ?? ""}
                      onChange={(value) => setMapping((prev) => ({ ...prev, [header]: value }))}
                    />
                  </div>
                </InlineStack>
              );
            })}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Checkbox
              label="Save this mapping as a reusable template"
              checked={saveAsTemplate}
              onChange={setSaveAsTemplate}
            />
            {saveAsTemplate && (
              <TextField
                label="Template name"
                autoComplete="off"
                value={templateName}
                onChange={setTemplateName}
                placeholder="e.g. WooCommerce export"
              />
            )}
          </BlockStack>
        </Card>

        <InlineStack gap="300">
          <Button variant="primary" loading={isSubmitting} onClick={handleConfirm}>
            Confirm mapping
          </Button>
          <Button onClick={() => navigate("/app/imports")}>Cancel</Button>
        </InlineStack>

        {previewRows.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Preview (first {previewRows.length} rows)
              </Text>
              <PreviewTable headers={headers} rows={previewRows} mapping={mapping} fieldLabelByKey={fieldLabelByKey} />
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

function PreviewTable({
  headers,
  rows,
  mapping,
  fieldLabelByKey,
}: {
  headers: string[];
  rows: { rowNumber: number; cells: string[] }[];
  mapping: Record<string, string>;
  fieldLabelByKey: Map<string, string>;
}) {
  return (
    <DataTable
      columnContentTypes={headers.map(() => "text")}
      headings={headers.map((h) => (mapping[h] ? `${h} → ${fieldLabelByKey.get(mapping[h])}` : h))}
      rows={rows.map((row) => row.cells)}
    />
  );
}
