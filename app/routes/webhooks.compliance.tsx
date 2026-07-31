import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { redactAllShopData, redactOrdersData } from "../models/importJob.server";
import { logAccess } from "../models/accessLog.server";
import db from "../db.server";

// The three GDPR-mandatory privacy webhooks (customers/data_request, customers/redact,
// shop/redact) share a single endpoint per Shopify's app config schema (compliance_topics on
// one [[webhooks.subscriptions]] block) — `topic` tells them apart at runtime, normalized to
// CUSTOMERS_DATA_REQUEST / CUSTOMERS_REDACT / SHOP_REDACT.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // OrderLink Up has no separate customer database - customer data only exists as raw cell
      // values inside imported rows. Fulfilling a data request is a manual support-side lookup
      // through the logged shop/customer id, not an automated export from this endpoint.
      const customer = payload.customer as { id?: number; email?: string } | undefined;
      const detail = `customer ${customer?.id ?? "unknown"} (${customer?.email ?? "no email"})`;
      await logAccess(shop, "customer_data_request", detail);
      console.log(`Received ${topic} webhook for ${shop} — ${detail} requested their data.`);
      break;
    }

    case "CUSTOMERS_REDACT": {
      const ordersToRedact = (payload.orders_to_redact as (string | number)[] | undefined) ?? [];
      const result = await redactOrdersData(shop, ordersToRedact);
      // Access log entries are kept even after a customer redact - they hold only metadata
      // (shop, action, an order id), not the customer's actual personal data, and preserving
      // them is what makes the audit trail meaningful for security review.
      await logAccess(shop, "customer_redact", `${result.count} row(s) redacted`);
      console.log(`Received ${topic} webhook for ${shop} — redacted ${result.count} row(s).`);
      break;
    }

    case "SHOP_REDACT": {
      await redactAllShopData(shop);
      await db.session.deleteMany({ where: { shop } });
      // Logged AFTER the shop's other data is gone, and deliberately not deleted alongside it -
      // same reasoning as the customer redact case above.
      await logAccess(shop, "shop_redact");
      console.log(`Received ${topic} webhook for ${shop} — all shop data redacted.`);
      break;
    }

    default:
      console.log(`Received unexpected ${topic} webhook for ${shop} on the compliance endpoint.`);
  }

  return new Response();
};
