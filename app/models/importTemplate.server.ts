import prisma from "../db.server";

export async function listImportTemplates(shop: string) {
  return prisma.importTemplate.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getImportTemplate(shop: string, id: string) {
  return prisma.importTemplate.findFirst({
    where: { id, shop },
  });
}

export async function createImportTemplate(
  shop: string,
  name: string,
  mapping: Record<string, string | null>,
) {
  return prisma.importTemplate.create({
    data: {
      shop,
      name,
      mapping: JSON.stringify(mapping),
    },
  });
}
