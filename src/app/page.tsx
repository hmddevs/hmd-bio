import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import HomeForm from "./HomeForm";

export const metadata: Metadata = {
  title: "HMD.bio — URL Shortener",
  description:
    "Fast, reliable URL shortening by HMD Developments. Create short, branded links instantly.",
};

export default function HomePage() {
  return (
    <main id="main-content" className="flex-1 px-4 py-16 sm:py-24">
      <div className="w-full max-w-3xl mx-auto">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "HMD.bio",
              url: "https://hmd.bio",
              description:
                "Fast, reliable URL shortening service by HMD Developments",
              applicationCategory: "UtilityApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              provider: {
                "@type": "Organization",
                name: "HMD Developments",
                url: "https://hmddevs.org",
              },
            }),
          }}
        />
        <SessionProvider>
          <HomeForm />
        </SessionProvider>
      </div>
    </main>
  );
}
