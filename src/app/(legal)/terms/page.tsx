import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "HMD.bio Terms of Service",
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-sm text-gray-500">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using HMD.bio (&quot;the Service&quot;), operated by HMD Developments (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.
      </p>

      <h2>2. Description of Service</h2>
      <p>
        HMD.bio is a URL shortening service that allows users to create shortened URLs that redirect to specified destinations. We may also provide analytics, QR code generation, and link management features.
      </p>

      <h2>3. User Conduct</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>Create links to illegal, harmful, or malicious content</li>
        <li>Distribute spam, malware, or phishing content</li>
        <li>Infringe on intellectual property rights of others</li>
        <li>Violate any applicable laws or regulations</li>
        <li>Interfere with or disrupt the Service</li>
      </ul>

      <h2>4. Link Management</h2>
      <p>
        We reserve the right to disable or remove any shortened URL at our sole discretion, including links that violate these Terms or our Acceptable Use Policy. Links may expire based on configured settings.
      </p>

      <h2>5. Disclaimer of Warranties</h2>
      <p>
        The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, or non-infringement.
      </p>

      <h2>6. Limitation of Liability</h2>
      <p>
        In no event shall HMD Developments be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.
      </p>

      <h2>7. Changes to Terms</h2>
      <p>
        We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance of the revised Terms.
      </p>

      <h2>8. Contact</h2>
      <p>
        For questions about these Terms, contact us at{" "}
        <a href="mailto:legal@hmddevs.org">legal@hmddevs.org</a>.
      </p>
    </>
  );
}
