import prisma from "../db.server";

export type AccessLogAction =
  | "order_created"
  | "customer_data_request"
  | "customer_redact"
  | "shop_redact";

export async function logAccess(shop: string, action: AccessLogAction, detail?: string) {
  await prisma.accessLog.create({ data: { shop, action, detail } });
}

// Import records (which may contain customer name/email/phone/address) are retained for 24
// months, or until the merchant deletes them, whichever comes first - see the retention policy
// documented on the /privacy and /terms pages. ImportRow cascades on ImportJob's deletion.
export const RETENTION_MONTHS = 24;

export async function purgeStaleImportJobs(): Promise<number> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

  const result = await prisma.importJob.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
