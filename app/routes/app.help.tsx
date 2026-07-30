import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  List,
  Badge,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ORDER_FIELDS, type OrderFieldSection } from "../lib/orderFields.server";

const SECTION_ORDER: OrderFieldSection[] = [
  "Order Info",
  "Customer",
  "Shipping Address",
  "Billing Address",
  "Line Item",
  "Payment & Totals",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {
    sections: SECTION_ORDER.map((section) => ({
      section,
      fields: ORDER_FIELDS.filter((f) => f.section === section).map((f) => ({
        label: f.label,
        defaultHeader: f.synonyms[0],
        description: f.description,
      })),
    })),
  };
};

export default function HelpPage() {
  const { sections } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page>
      <TitleBar title="Help" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              How importing orders works
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span" fontWeight="semibold">Pick a workflow.</Text>{" "}
                On the{" "}
                <Button variant="plain" onClick={() => navigate("/app/imports")}>
                  Imports
                </Button>{" "}
                page, choose Completed orders (paid, historical orders with their original date)
                or Draft orders (for manual review before anything becomes real).
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Upload your file.</Text> CSV or Excel, one
                row per line item. Migrating from another platform? Start from{" "}
                <Button variant="plain" onClick={() => navigate("/app/migrate")}>
                  Migrate store
                </Button>{" "}
                instead — it pre-fills column mapping for common platform exports.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Map your columns.</Text> OrderLink Up
                auto-suggests a mapping from your file's headers to Shopify order fields — review
                and adjust it, then save it as a template if you'll reuse this file format.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Review the validation check.</Text> Before
                anything is created, OrderLink Up flags rows with bad emails, missing product
                identifiers, invalid quantities/prices, or incomplete addresses — fix your file
                and re-upload, or skip the flagged rows and continue.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Products get matched automatically.</Text>{" "}
                Each row is matched to a variant in your store by SKU, barcode, or variant ID.
                Rows that don't match become a custom line item (or are skipped), depending on
                your Order options.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Create the orders.</Text> OrderLink Up creates
                orders a little at a time to respect Shopify's rate limits — larger imports take
                longer, and you'll see live progress. Failed orders can be retried individually.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Made a mistake?</Text> Every completed
                import can be rolled back with one click from its summary page, which cancels and
                deletes the orders it created in Shopify.
              </List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Tips
            </Text>
            <List>
              <List.Item>
                <Text as="span" fontWeight="semibold">Grouping rows into orders:</Text> map a
                column to Order Number and give every line item of the same order the same
                value. Rows with no Order Number each become their own single-item order.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Matching customers:</Text> Shopify matches
                by email, not by name — make sure Email is mapped and consistent across a
                customer's orders if you want them grouped under one customer record.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Product matching priority:</Text> Variant ID
                is checked first, then SKU, then Barcode. Turn on "Also match by product title" in
                Order options as a last-resort fallback for rows with none of those.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Safe by default:</Text> new imports don't
                email customers or touch inventory unless you turn those on in Order options —
                intentional, so a historical import doesn't surprise anyone.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Draft vs. completed:</Text> use Draft orders
                when you want to eyeball everything in Shopify Admin before it's real; use
                Completed orders for a bulk historical migration where you're confident in the
                data.
              </List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Common issues
            </Text>
            <List>
              <List.Item>
                <Text as="span" fontWeight="semibold">Import seems slow:</Text> Shopify limits how
                fast new orders can be created. OrderLink Up paces itself to stay under that limit
                automatically — large imports (hundreds of orders) can take a while to finish, and
                that's expected.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">A row failed:</Text> check its error message
                on the order creation screen — usually a missing price on a custom line item, or a
                product that no longer exists. Fix the underlying data (in Shopify or your Order
                options) and hit Retry on that row.
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Free plan limit:</Text> the free plan covers
                your first 25 orders imported, lifetime. After that, importing more needs the
                Unlimited Orders plan — check{" "}
                <Button variant="plain" onClick={() => navigate("/app/billing")}>
                  Billing
                </Button>
                .
              </List.Item>
              <List.Item>
                <Text as="span" fontWeight="semibold">Removed an import from Activity:</Text>{" "}
                removing history only deletes OrderLink Up's own record of the import — it never
                touches orders already created in Shopify. If you need to undo those orders, roll
                them back first, before removing the history.
              </List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Example file
              </Text>
              <Button
                onClick={() => {
                  const anchor = document.createElement("a");
                  anchor.href = "/sample-completed-orders-import.csv";
                  anchor.download = "sample-completed-orders-import.csv";
                  document.body.appendChild(anchor);
                  anchor.click();
                  anchor.remove();
                }}
              >
                Download example CSV
              </Button>
            </InlineStack>
            <Text as="p" tone="subdued">
              A ready-to-use sample showing the column headers OrderLink Up recognizes automatically
              — a good starting point for formatting your own export.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                All fields
              </Text>
              <Text as="p" tone="subdued">
                Every field OrderLink Up can map a column to, grouped by category. "Default header"
                is one example column name that's auto-detected — many similar variations are
                recognized too, and you can always map manually.
              </Text>
            </BlockStack>

            {sections.map(({ section, fields }, index) => (
              <BlockStack gap="300" key={section}>
                {index > 0 && <Divider />}
                <Text as="h3" variant="headingSm">
                  {section}
                </Text>
                <BlockStack gap="300">
                  {fields.map((field) => (
                    <BlockStack gap="050" key={field.label}>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {field.label}
                        </Text>
                        <Badge tone="info">{`Default header: ${field.defaultHeader}`}</Badge>
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        {field.description}
                      </Text>
                    </BlockStack>
                  ))}
                </BlockStack>
              </BlockStack>
            ))}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
