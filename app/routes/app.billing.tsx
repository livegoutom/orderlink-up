import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Badge, Button, ProgressBar } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  authenticate,
  UNLIMITED_PLAN_ANNUAL,
  UNLIMITED_PLAN_MONTHLY,
  UNLIMITED_PLANS,
  billingPlan,
  billingPlans,
} from "../shopify.server";
import { countLifetimeImportedOrders, FREE_ORDER_LIMIT } from "../models/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: billingPlans(...UNLIMITED_PLANS),
    isTest: true,
  });
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
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade") {
    const interval = formData.get("interval");
    const plan = interval === "annual" ? UNLIMITED_PLAN_ANNUAL : UNLIMITED_PLAN_MONTHLY;
    // isTest: true - development stores can't be charged real money regardless, but this must
    // be a deliberate switch before a real production launch, not something left as-is silently.
    await billing.request({ plan: billingPlan(plan), isTest: true });
    // billing.request() always throws a redirect to Shopify's confirmation page; unreachable.
    return null;
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

  const handleUpgrade = (interval: "monthly" | "annual") => {
    const formData = new FormData();
    formData.append("intent", "upgrade");
    formData.append("interval", interval);
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
                  You're on the Unlimited Orders plan (
                  {subscription?.isAnnual ? "$150/year" : "$15/month"}) — no order limits.
                </Text>
                <InlineStack>
                  <Button tone="critical" onClick={handleCancel} loading={isSubmitting}>
                    Cancel subscription
                  </Button>
                </InlineStack>
              </>
            ) : (
              <>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Free plan: {ordersUsed} / {limit} orders imported. Upgrade for unlimited order
                  imports.
                </Text>
                <ProgressBar progress={progress} tone={ordersUsed >= limit ? "critical" : "primary"} />
                <InlineStack gap="300">
                  <Button variant="primary" onClick={() => handleUpgrade("monthly")} loading={isSubmitting}>
                    Upgrade — $15/month
                  </Button>
                  <Button onClick={() => handleUpgrade("annual")} loading={isSubmitting}>
                    Upgrade — $150/year (save $30)
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
