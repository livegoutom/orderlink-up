import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Privacy Policy — OrderLink Up" }];

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px", lineHeight: 1.6, color: "#1a1a1a", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: "#6b6b6b", fontSize: 14, marginBottom: 40 }}>Last updated: August 1, 2026</p>

      <p>
        OrderLink Up ("the app") is a Shopify app that imports historical order data into a
        merchant's Shopify store from a CSV or Excel file. This policy explains what data the
        app collects, how it's used, and how it can be removed.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>Information we collect</h2>
      <p>When a merchant uses OrderLink Up, we process:</p>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          <strong>Order data from uploaded files</strong> — customer name, email, phone number,
          shipping and billing address, and order/product details contained in the file the
          merchant uploads.
        </li>
        <li>
          <strong>Shopify store and session data</strong> — obtained via Shopify's standard
          OAuth flow when the app is installed, used only to authenticate API requests to the
          merchant's own store.
        </li>
        <li>
          <strong>Import records</strong> — a log of each import job (filename, row count,
          status, and which Shopify orders it created), so the merchant can review history and
          roll back an import if needed.
        </li>
      </ul>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>How we use this information</h2>
      <p>
        Order data from an uploaded file is used solely to create the corresponding draft or
        completed orders in the merchant's own Shopify store via the Shopify Admin API. Import
        records are kept so the merchant can view their import history and reverse an import.
        We do not use this data for any other purpose, and we do not sell it.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>Data storage and sharing</h2>
      <p>
        Data is stored in a hosted PostgreSQL database and processed by our application server.
        The only third party we share data with is Shopify itself, via the Admin API calls
        required to create orders. We do not share merchant or customer data with any other
        third party.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>Data retention and deletion</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          Merchants can permanently delete any import's history at any time from the app's
          Activity page — this removes our stored record of that import, though it does not
          affect orders already created in Shopify.
        </li>
        <li>
          OrderLink Up implements Shopify's mandatory privacy webhooks: a customer data request
          is logged for manual fulfillment, a customer redaction request results in the
          affected order's stored data being redacted, and a shop redaction request (sent after
          the app is uninstalled) results in all of that shop's data being permanently deleted
          from our systems.
        </li>
      </ul>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>Security</h2>
      <p>
        Data is transmitted over HTTPS. Access to the merchant's store is scoped to the minimum
        permissions the app needs (product lookup, and order/draft order creation) and is
        authenticated using Shopify's standard OAuth token flow.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>Changes to this policy</h2>
      <p>
        If this policy changes, the updated version will be posted at this same URL with a
        revised "Last updated" date.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>Contact</h2>
      <p>
        Questions about this policy or your data can be sent to{" "}
        <a href="mailto:support@orderlinkup.app">support@orderlinkup.app</a>
        {" "}(replace with your real support address before publishing).
      </p>
    </div>
  );
}
