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
      <article className="legal-content max-w-none text-gray-700 dark:text-gray-300 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-gray-900 [&_h1]:dark:text-white [&_h1]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:dark:text-white [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-gray-800 [&_h3]:dark:text-gray-200 [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-4 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4 [&_ol]:space-y-1 [&_a]:text-blue-600 [&_a]:dark:text-blue-400 [&_a]:underline [&_table]:w-full [&_table]:mb-4 [&_table]:text-sm [&_th]:text-left [&_th]:p-2 [&_th]:border-b [&_th]:border-gray-300 [&_th]:dark:border-gray-700 [&_th]:font-semibold [&_td]:p-2 [&_td]:border-b [&_td]:border-gray-200 [&_td]:dark:border-gray-800 [&_strong]:font-semibold [&_strong]:text-gray-900 [&_strong]:dark:text-white">
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
