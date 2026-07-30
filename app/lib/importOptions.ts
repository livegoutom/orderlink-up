export type InventoryBehaviour =
  | "BYPASS"
  | "DECREMENT_OBEYING_POLICY"
  | "DECREMENT_IGNORING_POLICY";

export interface OrderImportOptions {
  lookupByTitle: boolean; // fallback product lookup by title (SKU/barcode/variantId always primary)
  unmatchedFallback: "custom_line_item" | "skip";
  upsertCustomers: boolean;
  sendOrderConfirmation: boolean; // paid mode only
  sendFulfillmentEmail: boolean; // paid mode only
  useBillingAsShipping: boolean;
  useShippingAsBilling: boolean;
  inventoryBehaviour: InventoryBehaviour;
  skipEmptyQuantities: boolean;
  useOrderNumberAsName: boolean;
}

export const DEFAULT_ORDER_IMPORT_OPTIONS: OrderImportOptions = {
  lookupByTitle: false,
  unmatchedFallback: "custom_line_item",
  upsertCustomers: false,
  sendOrderConfirmation: false,
  sendFulfillmentEmail: false,
  useBillingAsShipping: false,
  useShippingAsBilling: false,
  inventoryBehaviour: "BYPASS",
  skipEmptyQuantities: false,
  useOrderNumberAsName: false,
};

const INVENTORY_BEHAVIOURS: InventoryBehaviour[] = [
  "BYPASS",
  "DECREMENT_OBEYING_POLICY",
  "DECREMENT_IGNORING_POLICY",
];

/**
 * Parse a stored options JSON blob into a full OrderImportOptions.
 * Jobs created before this feature have no options JSON; their email/inventory
 * behavior derives from the legacy suppressNotifications flag.
 */
export function parseImportOptions(
  json: string | null | undefined,
  legacySuppressNotifications = true,
): OrderImportOptions {
  if (!json) {
    return {
      ...DEFAULT_ORDER_IMPORT_OPTIONS,
      sendOrderConfirmation: !legacySuppressNotifications,
      sendFulfillmentEmail: !legacySuppressNotifications,
      inventoryBehaviour: legacySuppressNotifications ? "BYPASS" : "DECREMENT_IGNORING_POLICY",
    };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...DEFAULT_ORDER_IMPORT_OPTIONS };
  }

  const bool = (key: keyof OrderImportOptions) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : DEFAULT_ORDER_IMPORT_OPTIONS[key] as boolean;

  return {
    lookupByTitle: bool("lookupByTitle"),
    unmatchedFallback: raw.unmatchedFallback === "skip" ? "skip" : "custom_line_item",
    upsertCustomers: bool("upsertCustomers"),
    sendOrderConfirmation: bool("sendOrderConfirmation"),
    sendFulfillmentEmail: bool("sendFulfillmentEmail"),
    useBillingAsShipping: bool("useBillingAsShipping"),
    useShippingAsBilling: bool("useShippingAsBilling"),
    inventoryBehaviour: INVENTORY_BEHAVIOURS.includes(raw.inventoryBehaviour as InventoryBehaviour)
      ? (raw.inventoryBehaviour as InventoryBehaviour)
      : "BYPASS",
    skipEmptyQuantities: bool("skipEmptyQuantities"),
    useOrderNumberAsName: bool("useOrderNumberAsName"),
  };
}
