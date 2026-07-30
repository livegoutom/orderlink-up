import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

interface VariantSearchNode {
  id: string;
  title: string;
  sku: string | null;
  product: { title: string };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return { variants: [] };
  }

  const response = await admin.graphql(
    `#graphql
      query SearchVariants($query: String!) {
        productVariants(first: 10, query: $query) {
          edges {
            node {
              id
              title
              sku
              product { title }
            }
          }
        }
      }`,
    { variables: { query: q } },
  );

  const json = await response.json();
  const edges = (json.data?.productVariants?.edges ?? []) as { node: VariantSearchNode }[];

  return {
    variants: edges.map(({ node }) => ({
      id: node.id,
      title: node.title,
      sku: node.sku,
      productTitle: node.product.title,
    })),
  };
};
