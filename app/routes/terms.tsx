import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Terms of Service & Data Processing Agreement — OrderLink Up" }];

export default function Terms() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px", lineHeight: 1.6, color: "#1a1a1a", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Terms of Service &amp; Data Processing Agreement</h1>
      <p style={{ color: "#6b6b6b", fontSize: 14, marginBottom: 40 }}>Last updated: August 1, 2026</p>

      <p>
        This agreement applies between the merchant installing OrderLink Up ("you," "the
        merchant") and OrderLink Up ("the app"). By installing the app, you agree to these terms.
        See our <a href="/privacy">Privacy Policy</a> for how we handle personal data in more
        detail — this page covers the contractual side of that relationship.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>1. Service description</h2>
      <p>
        OrderLink Up imports order data you provide (via CSV or Excel upload) into your Shopify
        store, creating draft or completed orders through the Shopify Admin API. That's the whole
        service — the app does not modify your storefront, theme, or checkout.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>2. Data processing roles</h2>
      <p>
        For any personal data contained in the files you upload (customer name, email, phone,
        address), you are the data controller and OrderLink Up acts as a data processor,
        processing that data only on your instructions and only for the purpose of creating the
        orders you asked to import. We do not use it for any other purpose.
      </p>
      <p>
        <strong>Sub-processors:</strong> we use Supabase (database hosting) and Railway
        (application hosting) to run the service. Both process data solely as infrastructure
        providers on our behalf, under their own standard security commitments; neither has
        access to your Shopify store directly.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>3. Data retention</h2>
      <p>
        Import records, including any personal data they contain, are retained for 24 months
        from creation and then automatically deleted, or deleted sooner if you remove them
        manually from the Activity page. Full detail is in our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>4. Security measures</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li>Data is encrypted in transit (HTTPS) and at rest.</li>
        <li>
          Access to your store is scoped to the minimum permissions the app needs (product
          lookup, order/draft order creation) via Shopify's own OAuth token system.
        </li>
        <li>
          Administrative access to the app's infrastructure (hosting, database) is limited to the
          app's operator, protected by unique credentials.
        </li>
        <li>
          An access log records when personal data is processed (e.g. when an order is created,
          or when a privacy-related webhook is received) for security accountability.
        </li>
      </ul>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>5. Security incident response</h2>
      <p>
        If we confirm a security incident affecting your data, we will: contain and assess the
        incident, remediate the underlying cause, and notify you without undue delay — within 72
        hours of confirming the incident where required by applicable law — along with what
        happened and what data was affected, so you can meet your own notification obligations if
        needed.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>6. Data loss prevention</h2>
      <p>
        Your data is stored in a managed PostgreSQL database (Supabase) that performs automated
        backups as part of its standard service. The application itself is version-controlled and
        deployed from source control, so the running service can be rebuilt and redeployed
        independently of any single server instance.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>7. Your responsibilities</h2>
      <p>
        You're responsible for the accuracy and legality of the data you upload — including
        having the right to import any customer personal data contained in your file into
        Shopify. Don't upload data you're not authorized to process.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>8. Liability</h2>
      <p>
        The app is provided as-is, without warranties beyond what's required by applicable
        consumer protection law. We're not liable for indirect or consequential losses arising
        from use of the app, to the maximum extent permitted by law.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>9. Termination</h2>
      <p>
        Uninstalling the app ends this agreement. Per Shopify's standard app lifecycle, your
        shop's data is fully and permanently deleted from our systems shortly after uninstall
        (see the Data retention and deletion section of our{" "}
        <a href="/privacy">Privacy Policy</a>).
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>10. Changes to these terms</h2>
      <p>
        If these terms change, the updated version will be posted at this same URL with a revised
        "Last updated" date.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 36 }}>11. Contact</h2>
      <p>
        Questions about this agreement can be sent to{" "}
        <a href="mailto:support@orderlinkup.app">support@orderlinkup.app</a>
        {" "}(replace with your real support address before publishing).
      </p>
    </div>
  );
}
