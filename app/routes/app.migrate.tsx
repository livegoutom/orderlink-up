import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, InlineGrid, Button } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { PLATFORM_PRESETS } from "../lib/platformPresets";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function MigrateStore() {
  const navigate = useNavigate();

  return (
    <Page>
      <TitleBar title="Migrate store" />
      <BlockStack gap="400">
        <Text as="p" variant="bodyMd" tone="subdued">
          Moving from another platform? Export your orders from your old store and pick it below
          — OrderLink Up pre-fills the column mapping using that platform's typical export format,
          so you spend less time matching columns by hand.
        </Text>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 2, lg: 4 }} gap="400">
          {PLATFORM_PRESETS.map((platform) => (
            <Card key={platform.id}>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {platform.name}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {platform.exportHint}
                </Text>
                <InlineStack>
                  <Button
                    variant="primary"
                    onClick={() => navigate(`/app/imports/new?platform=${platform.id}&mode=paid`)}
                  >
                    Start migration
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
