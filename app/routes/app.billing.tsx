import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Badge, Button, ProgressBar } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate, APP_HANDLE, UNLIMITED_PLAN_ANNUAL, UNLIMITED_PLANS, billingPlans } from "../shopify.server";
import { checkHasActivePayment, countLifetimeImportedOrders, FREE_ORDER_LIMIT } from "../models/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  // Classic Billing API check, kept separate from the combined check below because only a
  // classic subscription (not a Shopify App Pricing one) can be cancelled via billing.cancel().
  const { appSubscriptions } = await billing.check({
    plans: billingPlans(...UNLIMITED_PLANS),
    isTest: true,
  });
  const hasActivePayment = await checkHasActivePayment(admin, billing);
  const ordersUsed = await countLifetimeImportedOrders(session.shop);

  const activeSubscription = appSubscriptions[0];

  return {
    hasActivePayment,
    subscription: activeSubscription
      ? {
          id: activeSubscription.id,
          status: activeSubscription.status,
          isAnnual: activeSubscription.name === UNLIMITED_PLAN_ANNUAL,
        }
      : null,
    ordersUsed,
    limit: FREE_ORDER_LIMIT,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing, redirect: shopifyRedirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade") {
    // This app has Shopify App Pricing enabled, which means the classic Billing API can no
    // longer create NEW charges ("Managed Pricing Apps cannot use the Billing API") - merchants
    // pick a plan on Shopify's own hosted page instead, which already offers both the monthly
    // and yearly-discount options for this app's single "unlimited-orders" plan.
    const storeHandle = session.shop.replace(".myshopify.com", "");
    return shopifyRedirect(
      `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`,
      { target: "_top" },
    );
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId");
    if (typeof subscriptionId === "string") {
      await billing.cancel({ subscriptionId, isTest: true });
    }
    return redirect("/app/billing");
  }

  return { error: "Unknown action." };
};

export default function BillingPage() {
  const { hasActivePayment, subscription, ordersUsed, limit } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const handleUpgrade = () => {
    const formData = new FormData();
    formData.append("intent", "upgrade");
    submit(formData, { method: "post" });
  };

  const handleCancel = () => {
    if (!subscription) return;
    const formData = new FormData();
    formData.append("intent", "cancel");
    formData.append("subscriptionId", subscription.id);
    submit(formData, { method: "post" });
  };

  const progress = Math.min(100, Math.round((ordersUsed / limit) * 100));

  return (
    <Page>
      <TitleBar title="Billing" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Current plan
              </Text>
              <Badge tone={hasActivePayment ? "success" : "info"}>
                {hasActivePayment ? "Unlimited Orders" : "Free"}
              </Badge>
            </InlineStack>

            {hasActivePayment ? (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  You're on the Unlimited Orders plan
                  {subscription ? ` (${subscription.isAnnual ? "$150/year" : "$15/month"})` : ""} —
                  no order limits.
                </Text>
                {subscription ? (
                  <InlineStack>
                    <Button tone="critical" onClick={handleCancel} loading={isSubmitting}>
                      Cancel subscription
                    </Button>
                  </InlineStack>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Manage or cancel this subscription from Shopify Admin.
                  </Text>
                )}
              </>
            ) : (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Free plan: {ordersUsed} / {limit} orders imported. Upgrade for unlimited order
                  imports.
                </Text>
                <ProgressBar progress={progress} tone={ordersUsed >= limit ? "critical" : "primary"} />
                <InlineStack>
                  <Button variant="primary" onClick={handleUpgrade} loading={isSubmitting}>
                    Upgrade — from $15/month
                  </Button>
                </InlineStack>
              </>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
