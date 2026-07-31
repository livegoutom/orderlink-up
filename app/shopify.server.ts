import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export const UNLIMITED_PLAN_MONTHLY = "Unlimited Orders Monthly" as const;
export const UNLIMITED_PLAN_ANNUAL = "Unlimited Orders Annual" as const;
export const UNLIMITED_PLANS = [UNLIMITED_PLAN_MONTHLY, UNLIMITED_PLAN_ANNUAL] as const;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [UNLIMITED_PLAN_MONTHLY]: {
      lineItems: [{ amount: 15, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
    [UNLIMITED_PLAN_ANNUAL]: {
      lineItems: [{ amount: 150, currencyCode: "USD", interval: BillingInterval.Annual }],
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
// Billing has no top-level export - it's request-scoped, obtained via
// `const { billing } = await authenticate.admin(request)` in each route.

// Workaround for a pre-existing type-resolution issue in this template: duplicate
// @shopify/shopify-api package instances (the top-level dependency vs. the one nested inside
// shopify-app-remix - same root cause as the PrismaSessionStorage type mismatch that shows up
// in this file's own type-check) make billing.check/request's generic `plans`/`plan` params
// resolve to `never` at call sites, even though the runtime value is completely correct. These
// helpers carry the real string through with a type TypeScript will accept, instead of littering
// `as unknown as never` across every call site.
export function billingPlans(...plans: string[]): never[] {
  return plans as unknown as never[];
}
export function billingPlan(plan: string): never {
  return plan as unknown as never;
}
