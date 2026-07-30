export interface RowIdentifiers {
  sku?: string;
  barcode?: string;
  variantId?: string;
  productTitle?: string;
}

export interface MatchResult {
  matchedVariantId: string | null;
  matchedVariantTitle: string | null;
  matchType: "sku" | "barcode" | "variantId" | "title" | null;
}

export type AdminGraphqlClient = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

interface VariantNode {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  product: { title: string };
}

const BATCH_SIZE = 10;

export function extractRowIdentifiers(
  rawData: string[],
  headers: string[],
  columnMapping: Record<string, string>,
): RowIdentifiers {
  const get = (field: string): string | undefined => {
    const header = columnMapping[field];
    if (!header) return undefined;
    const index = headers.indexOf(header);
    if (index === -1) return undefined;
    const value = rawData[index]?.trim();
    return value ? value : undefined;
  };

  return {
    sku: get("sku"),
    barcode: get("barcode"),
    variantId: get("variantId"),
    productTitle: get("productTitle"),
  };
}

export interface MatchOptions {
  lookupByTitle?: boolean;
}

export async function matchRowsBatch(
  admin: { graphql: AdminGraphqlClient },
  rows: { id: string; identifiers: RowIdentifiers }[],
  matchOptions: MatchOptions = {},
): Promise<Map<string, MatchResult>> {
  const results = new Map<string, MatchResult>();

  const queryableRows = rows.filter((r) => hasQueryableIdentifier(r.identifiers));
  for (const row of rows) {
    if (!hasQueryableIdentifier(row.identifiers)) {
      results.set(row.id, { matchedVariantId: null, matchedVariantTitle: null, matchType: null });
    }
  }

  for (let i = 0; i < queryableRows.length; i += BATCH_SIZE) {
    const batch = queryableRows.slice(i, i + BATCH_SIZE);
    const batchResults = await runBatch(admin, batch);
    for (const [id, result] of batchResults) {
      results.set(id, result);
    }
  }

  // Optional fallback pass: rows still unmatched whose productTitle is present
  // get a product-title search (first variant of the first matching product).
  if (matchOptions.lookupByTitle) {
    const titleRows = rows.filter(
      (r) => !results.get(r.id)?.matchedVariantId && r.identifiers.productTitle,
    );
    for (let i = 0; i < titleRows.length; i += BATCH_SIZE) {
      const batch = titleRows.slice(i, i + BATCH_SIZE);
      const batchResults = await runTitleBatch(admin, batch);
      for (const [id, result] of batchResults) {
        if (result.matchedVariantId) results.set(id, result);
      }
    }
  }

  return results;
}

async function runTitleBatch(
  admin: { graphql: AdminGraphqlClient },
  batch: { id: string; identifiers: RowIdentifiers }[],
): Promise<Map<string, MatchResult>> {
  const aliasToRow = new Map<string, { id: string; identifiers: RowIdentifiers }>();
  const varDecls: string[] = [];
  const variables: Record<string, unknown> = {};
  const fragments: string[] = [];

  batch.forEach((row, index) => {
    const alias = `t${index}`;
    aliasToRow.set(alias, row);
    const varName = `q${index}`;
    varDecls.push(`$${varName}: String!`);
    variables[varName] = `title:${quoteSearchTerm(row.identifiers.productTitle!)}`;
    fragments.push(
      `${alias}: products(first: 1, query: $${varName}) { edges { node { title variants(first: 1) { edges { node { id title sku barcode } } } } } }`,
    );
  });

  const query = `#graphql
    query MatchByTitle(${varDecls.join(", ")}) {
      ${fragments.join("\n      ")}
    }
  `;

  const json = await executeWithThrottleRetry(admin, query, variables);
  const results = new Map<string, MatchResult>();

  for (const [alias, row] of aliasToRow) {
    const productNode = json.data?.[alias]?.edges?.[0]?.node;
    const variant = productNode?.variants?.edges?.[0]?.node;
    if (productNode && variant) {
      results.set(row.id, {
        matchedVariantId: variant.id,
        matchedVariantTitle: `${productNode.title} - ${variant.title}`,
        matchType: "title",
      });
    } else {
      results.set(row.id, { matchedVariantId: null, matchedVariantTitle: null, matchType: null });
    }
  }

  return results;
}

function hasQueryableIdentifier(identifiers: RowIdentifiers): boolean {
  return Boolean(identifiers.variantId || identifiers.sku || identifiers.barcode);
}

function buildSearchQuery(identifiers: RowIdentifiers): string | null {
  const parts: string[] = [];
  if (identifiers.sku) parts.push(`sku:${quoteSearchTerm(identifiers.sku)}`);
  if (identifiers.barcode) parts.push(`barcode:${quoteSearchTerm(identifiers.barcode)}`);
  if (parts.length === 0) return null;
  return parts.join(" OR ");
}

function quoteSearchTerm(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function toVariantGid(value: string): string {
  if (value.startsWith("gid://shopify/ProductVariant/")) return value;
  const numeric = value.replace(/\D/g, "");
  return `gid://shopify/ProductVariant/${numeric}`;
}

const VARIANT_FIELDS = `id title sku barcode product { title }`;

async function runBatch(
  admin: { graphql: AdminGraphqlClient },
  batch: { id: string; identifiers: RowIdentifiers }[],
): Promise<Map<string, MatchResult>> {
  const aliasToRow = new Map<string, { id: string; identifiers: RowIdentifiers }>();
  const varDecls: string[] = [];
  const variables: Record<string, unknown> = {};
  const fragments: string[] = [];

  batch.forEach((row, index) => {
    const alias = `r${index}`;
    aliasToRow.set(alias, row);

    if (row.identifiers.variantId) {
      const varName = `id${index}`;
      varDecls.push(`$${varName}: ID!`);
      variables[varName] = toVariantGid(row.identifiers.variantId);
      fragments.push(
        `${alias}: node(id: $${varName}) { ... on ProductVariant { ${VARIANT_FIELDS} } }`,
      );
    } else {
      const varName = `q${index}`;
      varDecls.push(`$${varName}: String!`);
      variables[varName] = buildSearchQuery(row.identifiers);
      fragments.push(
        `${alias}: productVariants(first: 1, query: $${varName}) { edges { node { ${VARIANT_FIELDS} } } }`,
      );
    }
  });

  const query = `#graphql
    query MatchVariants(${varDecls.join(", ")}) {
      ${fragments.join("\n      ")}
    }
  `;

  const json = await executeWithThrottleRetry(admin, query, variables);
  const results = new Map<string, MatchResult>();

  for (const [alias, row] of aliasToRow) {
    const node = json.data?.[alias];
    let variant: VariantNode | null = null;

    if (node && Array.isArray(node.edges)) {
      variant = node.edges[0]?.node ?? null;
    } else if (node && typeof node === "object" && "id" in node) {
      variant = node as VariantNode;
    }

    if (variant) {
      const matchType: MatchResult["matchType"] = row.identifiers.variantId
        ? "variantId"
        : row.identifiers.sku
          ? "sku"
          : "barcode";
      results.set(row.id, {
        matchedVariantId: variant.id,
        matchedVariantTitle: `${variant.product.title} - ${variant.title}`,
        matchType,
      });
    } else {
      results.set(row.id, { matchedVariantId: null, matchedVariantTitle: null, matchType: null });
    }
  }

  return results;
}

async function executeWithThrottleRetry(
  admin: { graphql: AdminGraphqlClient },
  query: string,
  variables: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();

  const throttled = Array.isArray(json.errors)
    ? json.errors.some((e: { extensions?: { code?: string } }) => e.extensions?.code === "THROTTLED")
    : false;

  if (throttled) {
    const restoreRate = json.extensions?.cost?.throttleStatus?.restoreRate ?? 50;
    const delayMs = Math.min(2000, Math.max(200, Math.ceil((1 / restoreRate) * 1000)));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const retryResponse = await admin.graphql(query, { variables });
    return retryResponse.json();
  }

  return json;
}
