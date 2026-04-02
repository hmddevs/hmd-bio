import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Documentation",
  description: "HMD.bio REST API documentation — OpenAPI / Swagger",
  robots: { index: false, follow: false },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
