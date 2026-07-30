export type OrderFieldSection =
  | "Order Info"
  | "Customer"
  | "Shipping Address"
  | "Billing Address"
  | "Line Item"
  | "Payment & Totals";

export interface OrderFieldDef {
  key: string;
  label: string;
  section: OrderFieldSection;
  synonyms: string[];
  description: string;
}

export const ORDER_FIELDS: OrderFieldDef[] = [
  // Order Info
  { key: "orderNumber", label: "Order Number", section: "Order Info", synonyms: ["order number", "order id", "order name", "order #", "ordernumber"], description: "Groups rows into one order — every row sharing the same Order Number becomes a line item on the same Shopify order. Leave it blank on a row and that row becomes its own single-item order. With \"Use Order Number as order name\" turned on in Order options, this value also becomes the order's name in Shopify (e.g. #1001)." },
  { key: "orderDate", label: "Order Date", section: "Order Info", synonyms: ["order date", "date", "created at", "purchase date"], description: "Sets the order's historical date in Shopify, so completed/paid imports show up with the date they actually happened instead of today's date. Ignored for draft orders (Shopify doesn't support backdating drafts)." },
  { key: "currency", label: "Currency", section: "Order Info", synonyms: ["currency", "currency code"], description: "Currency code for the order (e.g. USD, CAD, GBP). If left unmapped, your shop's default currency is used for every order." },
  { key: "tags", label: "Tags", section: "Order Info", synonyms: ["tags", "order tags"], description: "Comma-separated tags applied to the order — useful for filtering imported orders later (e.g. \"imported, migration-2026\")." },
  { key: "note", label: "Note", section: "Order Info", synonyms: ["note", "notes", "order note", "comments"], description: "Free-text note attached to the order, visible in Shopify Admin." },

  // Customer
  { key: "email", label: "Email", section: "Customer", synonyms: ["email", "customer email", "email address", "buyer email"], description: "Customer email. This is how Shopify links an order to a customer record — matching by email, not by name. Required for a row to pass validation cleanly, and it's the field \"Upsert customers\" uses to create or update the customer." },
  { key: "firstName", label: "First Name", section: "Customer", synonyms: ["first name", "firstname", "customer first name"], description: "Customer's first name — used on the shipping address and, with \"Upsert customers\" on, the customer record." },
  { key: "lastName", label: "Last Name", section: "Customer", synonyms: ["last name", "lastname", "surname", "customer last name"], description: "Customer's last name — used on the shipping address and, with \"Upsert customers\" on, the customer record." },
  { key: "phone", label: "Phone", section: "Customer", synonyms: ["phone", "phone number", "customer phone", "telephone"], description: "Customer phone number, attached to the shipping address." },

  // Shipping Address
  { key: "address1", label: "Address Line 1", section: "Shipping Address", synonyms: ["address", "address1", "address line 1", "street", "shipping address"], description: "Street address. If this is mapped and a row has a value, City and Country must also be present, or that row fails the dry-run validation check." },
  { key: "address2", label: "Address Line 2", section: "Shipping Address", synonyms: ["address2", "address line 2", "apt", "suite", "unit"], description: "Apartment, suite, or unit number." },
  { key: "city", label: "City", section: "Shipping Address", synonyms: ["city", "town"], description: "City for the shipping address." },
  { key: "province", label: "Province / State", section: "Shipping Address", synonyms: ["province", "state", "region", "state/province"], description: "Province or state for the shipping address." },
  { key: "zip", label: "Zip / Postal Code", section: "Shipping Address", synonyms: ["zip", "zip code", "postal code", "postcode"], description: "Postal or zip code for the shipping address." },
  { key: "country", label: "Country", section: "Shipping Address", synonyms: ["country", "country code"], description: "Country for the shipping address (name or country code)." },
  { key: "company", label: "Company", section: "Shipping Address", synonyms: ["company", "company name", "business name"], description: "Company name on the shipping address." },

  // Billing Address
  { key: "billingFirstName", label: "Billing First Name", section: "Billing Address", synonyms: ["billing first name"], description: "First name on the billing address, if different from shipping." },
  { key: "billingLastName", label: "Billing Last Name", section: "Billing Address", synonyms: ["billing last name"], description: "Last name on the billing address, if different from shipping." },
  { key: "billingAddress1", label: "Billing Address Line 1", section: "Billing Address", synonyms: ["billing address", "billing address1", "billing address line 1", "billing street"], description: "Billing street address. Only sent to Shopify if at least one billing field is mapped — or you can skip this whole section and use \"Use shipping as billing\" in Order options instead." },
  { key: "billingAddress2", label: "Billing Address Line 2", section: "Billing Address", synonyms: ["billing address2", "billing address line 2"], description: "Billing apartment, suite, or unit number." },
  { key: "billingCity", label: "Billing City", section: "Billing Address", synonyms: ["billing city"], description: "City for the billing address." },
  { key: "billingProvince", label: "Billing Province / State", section: "Billing Address", synonyms: ["billing province", "billing state"], description: "Province or state for the billing address." },
  { key: "billingZip", label: "Billing Zip / Postal Code", section: "Billing Address", synonyms: ["billing zip", "billing postal code", "billing postcode"], description: "Postal or zip code for the billing address." },
  { key: "billingCountry", label: "Billing Country", section: "Billing Address", synonyms: ["billing country"], description: "Country for the billing address." },
  { key: "billingCompany", label: "Billing Company", section: "Billing Address", synonyms: ["billing company"], description: "Company name on the billing address." },

  // Line Item
  { key: "sku", label: "SKU", section: "Line Item", synonyms: ["sku", "variant sku", "product sku"], description: "Primary product identifier — matched against your store's variant SKUs. Checked first unless Variant ID is also mapped for that row." },
  { key: "barcode", label: "Barcode", section: "Line Item", synonyms: ["barcode", "upc", "ean"], description: "Alternative product identifier (UPC/EAN) — matched against variant barcodes when SKU doesn't find a match." },
  { key: "variantId", label: "Variant ID", section: "Line Item", synonyms: ["variant id", "variantid", "shopify variant id"], description: "Exact Shopify variant ID or GID. If mapped, this is used before SKU or barcode — the fastest and most precise way to match a row to a variant." },
  { key: "productTitle", label: "Product Title", section: "Line Item", synonyms: ["product title", "product name", "item name", "title"], description: "Used two ways: as a last-resort match by product name when \"Also match by product title\" is turned on in Order options, and as the line item's title when a row has no product match and becomes a custom line item instead." },
  { key: "quantity", label: "Quantity", section: "Line Item", synonyms: ["qty", "quantity", "units"], description: "Units for the line item. Must be a positive whole number; defaults to 1 if left unmapped or blank." },
  { key: "lineItemPrice", label: "Line Item Price", section: "Line Item", synonyms: ["price", "unit price", "item price", "line item price"], description: "The price actually paid per unit. Required when a row has no matched variant and becomes a custom line item; optional when a variant is matched, where it overrides today's Shopify price with the historical price the customer actually paid." },
  { key: "lineDiscount", label: "Line Discount", section: "Line Item", synonyms: ["line discount", "item discount", "discount"], description: "Not yet applied to created orders — captured in your file but not sent to Shopify. Line-level discounts aren't built into order creation yet." },

  // Payment & Totals
  { key: "subtotal", label: "Subtotal", section: "Payment & Totals", synonyms: ["subtotal", "sub total"], description: "Informational only — not sent to Shopify. Shopify calculates the order subtotal automatically from the line items it creates." },
  { key: "shippingCost", label: "Shipping Cost", section: "Payment & Totals", synonyms: ["shipping", "shipping cost", "shipping price"], description: "Added to the order as a shipping line, so it's reflected in the order total. This one is actually applied, unlike Subtotal/Tax/Total below." },
  { key: "tax", label: "Tax", section: "Payment & Totals", synonyms: ["tax", "tax amount", "sales tax"], description: "Not yet applied to created orders — captured in your file but not sent to Shopify. Shopify calculates tax based on your store's own tax settings rather than an imported historical amount." },
  { key: "total", label: "Total", section: "Payment & Totals", synonyms: ["total", "order total", "grand total"], description: "Not sent to Shopify — the order total is always computed from its line items plus the shipping line, the same way Shopify computes totals for any order." },
  { key: "discountTotal", label: "Discount Total", section: "Payment & Totals", synonyms: ["discount total", "total discount", "coupon amount"], description: "Not yet applied to created orders — captured in your file but not sent to Shopify. Order-level discount line items aren't built into order creation yet." },
  { key: "financialStatus", label: "Financial Status", section: "Payment & Totals", synonyms: ["financial status", "payment status", "status"], description: "Not currently applied — orders created via the \"Completed orders\" workflow are always marked Paid in Shopify, regardless of what this column contains." },
];

export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * For each source header, suggest the best-matching target field key (or null).
 * Exact normalized synonym match wins; falls back to substring containment.
 */
export function autoDetectMapping(headers: string[]): Record<string, string | null> {
  const suggestions: Record<string, string | null> = {};
  const usedTargets = new Set<string>();

  for (const header of headers) {
    const normalizedHeader = normalize(header);
    let match: OrderFieldDef | null = null;

    for (const field of ORDER_FIELDS) {
      if (usedTargets.has(field.key)) continue;
      if (field.synonyms.some((syn) => normalize(syn) === normalizedHeader)) {
        match = field;
        break;
      }
    }

    if (!match) {
      for (const field of ORDER_FIELDS) {
        if (usedTargets.has(field.key)) continue;
        if (field.synonyms.some((syn) => normalizedHeader.includes(normalize(syn)))) {
          match = field;
          break;
        }
      }
    }

    suggestions[header] = match ? match.key : null;
    if (match) usedTargets.add(match.key);
  }

  return suggestions;
}
