import { getCell } from "./orderGrouping.server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRow(
  cells: string[],
  headers: string[],
  columnMapping: Record<string, string>,
): string[] {
  const errors: string[] = [];
  const get = (field: string) => getCell(cells, headers, columnMapping, field);

  if (columnMapping.email) {
    const email = get("email");
    if (!email) {
      errors.push("Email is missing");
    } else if (!EMAIL_REGEX.test(email)) {
      errors.push("Invalid email format");
    }
  }

  const hasIdentifier = ["sku", "barcode", "variantId", "productTitle"].some((field) => get(field));
  if (!hasIdentifier) {
    errors.push("No product identifier (SKU, barcode, variant ID, or product title) found for this row");
  }

  if (columnMapping.quantity) {
    const quantity = get("quantity");
    if (quantity && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || !Number.isInteger(Number(quantity)))) {
      errors.push("Invalid quantity");
    }
  }

  if (columnMapping.lineItemPrice) {
    const price = get("lineItemPrice");
    if (price && (!Number.isFinite(Number(price)) || Number(price) < 0)) {
      errors.push("Invalid price");
    }
  }

  if (columnMapping.address1) {
    const address1 = get("address1");
    if (address1) {
      const city = get("city");
      const country = get("country");
      if (!city || !country) {
        errors.push("Incomplete shipping address (missing city/country)");
      }
    }
  }

  if (columnMapping.orderDate) {
    const orderDate = get("orderDate");
    if (orderDate && Number.isNaN(new Date(orderDate).getTime())) {
      errors.push("Invalid order date");
    }
  }

  return errors;
}
