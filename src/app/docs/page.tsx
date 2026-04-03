"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-gray-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6 text-sm text-zinc-400">
          These are the <strong>public</strong> API endpoints. Admin endpoints
          are available at <code>/api/admin/docs</code> (requires
          authentication).
        </div>
        <SwaggerUI url="/api/docs" />
      </div>
    </main>
  );
}
