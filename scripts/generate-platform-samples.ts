// Generates one example CSV per platform in public/samples/, using each platform's REAL
// headerSynonyms from platformPresets.ts as the column headers - so the example file always
// matches what the app actually auto-detects for that platform, and can't drift out of sync.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_PRESETS } from "../app/lib/platformPresets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Two line items sharing the same order number, to also demonstrate order-grouping behavior.
const SAMPLE_VALUES: Record<string, [string, string]> = {
  orderNumber: ["1001", "1001"],
  orderDate: ["2026-01-15", "2026-01-15"],
  currency: ["USD", "USD"],
  tags: ["vip", "vip"],
  note: ["Gift wrap requested", "Gift wrap requested"],
  email: ["jane.doe@example.com", "jane.doe@example.com"],
  firstName: ["Jane", "Jane"],
  lastName: ["Doe", "Doe"],
  phone: ["+1 555-0100", "+1 555-0100"],
  address1: ["123 Main St", "123 Main St"],
  address2: ["Apt 4B", "Apt 4B"],
  city: ["Los Angeles", "Los Angeles"],
  province: ["CA", "CA"],
  zip: ["90001", "90001"],
  country: ["US", "US"],
  company: ["", ""],
  billingAddress1: ["123 Main St", "123 Main St"],
  billingAddress2: ["Apt 4B", "Apt 4B"],
  billingCity: ["Los Angeles", "Los Angeles"],
  billingProvince: ["CA", "CA"],
  billingZip: ["90001", "90001"],
  billingCountry: ["US", "US"],
  billingCompany: ["", ""],
  sku: ["SKU-100", "SKU-101"],
  productTitle: ["Classic T-Shirt - Medium", "Canvas Tote Bag"],
  quantity: ["2", "1"],
  lineItemPrice: ["19.99", "24.99"],
  lineDiscount: ["0.00", "0.00"],
  subtotal: ["64.97", "64.97"],
  shippingCost: ["5.99", "5.99"],
  tax: ["5.20", "5.20"],
  total: ["76.16", "76.16"],
  discountTotal: ["0.00", "0.00"],
  financialStatus: ["Paid", "Paid"],
};

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const outDir = path.join(__dirname, "..", "public", "samples");
fs.mkdirSync(outDir, { recursive: true });

for (const platform of PLATFORM_PRESETS) {
  const fieldKeys = Object.keys(platform.headerSynonyms);
  const headers = fieldKeys.map((key) => platform.headerSynonyms[key]![0]);

  const row1 = fieldKeys.map((key) => SAMPLE_VALUES[key]?.[0] ?? "");
  const row2 = fieldKeys.map((key) => SAMPLE_VALUES[key]?.[1] ?? "");

  const csv = [headers, row1, row2].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
  const outPath = path.join(outDir, `${platform.id}-sample-orders.csv`);
  fs.writeFileSync(outPath, csv);
  console.log(`Wrote ${outPath} (${headers.length} columns)`);
}
