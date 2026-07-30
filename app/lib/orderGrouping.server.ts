import type { OrderImportOptions } from "./importOptions";
import { DEFAULT_ORDER_IMPORT_OPTIONS } from "./importOptions";

export interface RowForGrouping {
  id: string;
  cells: string[];
  matchStatus: string;
  matchedVariantId: string | null;
  matchedVariantTitle: string | null;
}

export type OrderMode = "draft" | "paid";

export interface BuildPayloadOptions {
  orderMode: OrderMode;
  shopCurrency: string;
  importOptions?: OrderImportOptions;
}

export type OrderPayloadResult =
  | { skip: true }
  | { error: string }
  | { draftInput: Record<string, unknown> }
  | { orderInput: Record<string, unknown>; options: Record<string, unknown> };

export function computeGroupKey(
  cells: string[],
  headers: string[],
  columnMapping: Record<string, string>,
  rowId: string,
): string {
  const value = getCell(cells, headers, columnMapping, "orderNumber");
  return value ? value : `row:${rowId}`;
}

export function getCell(
  cells: string[],
  headers: string[],
  columnMapping: Record<string, string>,
  field: string,
): string | undefined {
  const header = columnMapping[field];
  if (!header) return undefined;
  const index = headers.indexOf(header);
  if (index === -1) return undefined;
  const value = cells[index]?.trim();
  return value ? value : undefined;
}

function moneyInput(amount: string, currencyCode: string) {
  return { amount, currencyCode };
}

function moneyBag(amount: string, currencyCode: string) {
  return { shopMoney: moneyInput(amount, currencyCode) };
}

function parseOrderDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

const SHIPPING_ADDRESS_FIELDS: Record<string, string> = {
  address1: "address1",
  address2: "address2",
  city: "city",
  province: "province",
  zip: "zip",
  country: "country",
  company: "company",
  firstName: "firstName",
  lastName: "lastName",
  phone: "phone",
};

const BILLING_ADDRESS_FIELDS: Record<string, string> = {
  billingAddress1: "address1",
  billingAddress2: "address2",
  billingCity: "city",
  billingProvince: "province",
  billingZip: "zip",
  billingCountry: "country",
  billingCompany: "company",
  billingFirstName: "firstName",
  billingLastName: "lastName",
};

function buildAddress(
  cells: string[],
  headers: string[],
  columnMapping: Record<string, string>,
  fieldToKey: Record<string, string>,
): Record<string, string> | null {
  const address: Record<string, string> = {};
  for (const [field, key] of Object.entries(fieldToKey)) {
    const value = getCell(cells, headers, columnMapping, field);
    if (value) address[key] = value;
  }
  return Object.keys(address).length > 0 ? address : null;
}

function isEmptyQuantity(quantityRaw: string | undefined): boolean {
  if (!quantityRaw) return true;
  const n = Number(quantityRaw);
  return !Number.isFinite(n) || n <= 0;
}

function buildLineItems(
  rows: RowForGrouping[],
  headers: string[],
  columnMapping: Record<string, string>,
  orderMode: OrderMode,
  currency: string,
): { items: Record<string, unknown>[] } | { error: string } {
  const items: Record<string, unknown>[] = [];

  for (const row of rows) {
    const quantityRaw = getCell(row.cells, headers, columnMapping, "quantity");
    const quantity = quantityRaw ? Math.max(1, Math.round(Number(quantityRaw)) || 1) : 1;
    const price = getCell(row.cells, headers, columnMapping, "lineItemPrice");

    if (row.matchedVariantId) {
      if (orderMode === "draft") {
        items.push({ variantId: row.matchedVariantId, quantity });
      } else {
        const item: Record<string, unknown> = { variantId: row.matchedVariantId, quantity };
        if (price) item.priceSet = moneyBag(price, currency);
        items.push(item);
      }
      continue;
    }

    // custom_line_item (or manual resolution without a real variant, which shouldn't happen, but
    // treat defensively the same as custom): needs a title and a price.
    const title =
      getCell(row.cells, headers, columnMapping, "productTitle") ??
      getCell(row.cells, headers, columnMapping, "sku") ??
      row.matchedVariantTitle;

    if (!title) {
      return { error: "A custom line item needs at least a Product Title or SKU mapped." };
    }
    if (!price) {
      return { error: `Custom line item "${title}" needs a price (map "Line Item Price").` };
    }

    if (orderMode === "draft") {
      items.push({ title, quantity, originalUnitPriceWithCurrency: moneyInput(price, currency) });
    } else {
      items.push({ title, quantity, priceSet: moneyBag(price, currency) });
    }
  }

  return { items };
}

export function buildOrderPayload(
  rows: RowForGrouping[],
  headers: string[],
  columnMapping: Record<string, string>,
  options: BuildPayloadOptions,
): OrderPayloadResult {
  const importOptions = options.importOptions ?? DEFAULT_ORDER_IMPORT_OPTIONS;

  let activeRows = rows.filter((r) => r.matchStatus !== "skipped");
  if (importOptions.skipEmptyQuantities) {
    activeRows = activeRows.filter(
      (r) => !isEmptyQuantity(getCell(r.cells, headers, columnMapping, "quantity")),
    );
  }
  if (activeRows.length === 0) {
    return { skip: true };
  }

  const first = activeRows[0];
  const email = getCell(first.cells, headers, columnMapping, "email");
  const currency = getCell(first.cells, headers, columnMapping, "currency") ?? options.shopCurrency;
  const orderDate = getCell(first.cells, headers, columnMapping, "orderDate");
  const tagsRaw = getCell(first.cells, headers, columnMapping, "tags");
  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;
  const note = getCell(first.cells, headers, columnMapping, "note");

  let billingAddress = buildAddress(first.cells, headers, columnMapping, BILLING_ADDRESS_FIELDS);
  let shippingAddress = buildAddress(first.cells, headers, columnMapping, SHIPPING_ADDRESS_FIELDS);
  if (importOptions.useBillingAsShipping && billingAddress) {
    shippingAddress = billingAddress;
  } else if (importOptions.useShippingAsBilling && shippingAddress) {
    billingAddress = shippingAddress;
  }

  const lineItemsResult = buildLineItems(activeRows, headers, columnMapping, options.orderMode, currency);
  if ("error" in lineItemsResult) {
    return { error: lineItemsResult.error };
  }

  if (options.orderMode === "draft") {
    const draftInput: Record<string, unknown> = { lineItems: lineItemsResult.items };
    if (email) draftInput.email = email;
    if (shippingAddress) draftInput.shippingAddress = shippingAddress;
    if (billingAddress) draftInput.billingAddress = billingAddress;
    if (note) draftInput.note = note;
    if (tags) draftInput.tags = tags;
    return { draftInput };
  }

  const orderInput: Record<string, unknown> = {
    lineItems: lineItemsResult.items,
    currency,
    financialStatus: "PAID",
  };
  if (shippingAddress) orderInput.shippingAddress = shippingAddress;
  if (billingAddress) orderInput.billingAddress = billingAddress;
  if (note) orderInput.note = note;
  if (tags) orderInput.tags = tags;

  if (importOptions.upsertCustomers && email) {
    orderInput.customer = {
      toUpsert: {
        email,
        firstName: getCell(first.cells, headers, columnMapping, "firstName"),
        lastName: getCell(first.cells, headers, columnMapping, "lastName"),
      },
    };
  } else if (email) {
    orderInput.email = email;
  }

  if (importOptions.useOrderNumberAsName) {
    const orderNumber = getCell(first.cells, headers, columnMapping, "orderNumber");
    if (orderNumber) orderInput.name = orderNumber;
  }

  const processedAt = parseOrderDate(orderDate);
  if (processedAt) orderInput.processedAt = processedAt;

  const shippingCost = getCell(first.cells, headers, columnMapping, "shippingCost");
  if (shippingCost) {
    orderInput.shippingLines = [{ title: "Shipping", priceSet: moneyBag(shippingCost, currency) }];
  }

  const createOptions: Record<string, unknown> = {
    sendReceipt: importOptions.sendOrderConfirmation,
    sendFulfillmentReceipt: importOptions.sendFulfillmentEmail,
    inventoryBehaviour: importOptions.inventoryBehaviour,
  };

  return { orderInput, options: createOptions };
}
