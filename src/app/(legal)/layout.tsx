import Link from "next/link";

const legalLinks = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/aup", label: "Acceptable Use Policy" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="flex-1 px-4 py-12 max-w-3xl mx-auto w-full">
      <nav className="mb-8 flex flex-wrap gap-3 text-sm" aria-label="Legal pages">
        {legalLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <article className="prose dark:prose-invert max-w-none">
        {children}
      </article>
      <footer className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 text-sm text-gray-500 dark:text-gray-500">
        <p>
          © {new Date().getFullYear()}{" "}
          <a href="https://hmddevs.org" className="text-blue-500 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
            HMD Developments
          </a>
          . All rights reserved.
        </p>
      </footer>
    </main>
  );
}
