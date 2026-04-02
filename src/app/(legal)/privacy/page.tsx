import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "HMD.bio Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-gray-500">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

      <h2>1. Introduction</h2>
      <p>
        HMD Developments (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates HMD.bio. This Privacy Policy explains what information we collect, how we use it, and your rights regarding that information.
      </p>

      <h2>2. Information We Collect</h2>
      <h3>When you create a short link:</h3>
      <ul>
        <li>The destination URL you provide</li>
        <li>Your IP address (for rate limiting and abuse prevention)</li>
      </ul>

      <h3>When someone clicks a short link:</h3>
      <ul>
        <li>IP address (used to determine country; not stored long-term in identifiable form)</li>
        <li>Referrer URL</li>
        <li>Browser and operating system (derived from User-Agent)</li>
        <li>Country code (derived from IP geolocation)</li>
        <li>Timestamp of click</li>
      </ul>

      <h3>Admin accounts:</h3>
      <ul>
        <li>Username and hashed password</li>
        <li>Session data for authentication</li>
      </ul>

      <h2>3. How We Use Information</h2>
      <p>We use collected information to:</p>
      <ul>
        <li>Provide and operate the URL shortening service</li>
        <li>Generate anonymous click analytics for link owners</li>
        <li>Prevent abuse, spam, and malicious activity</li>
        <li>Improve the Service</li>
      </ul>

      <h2>4. Data Sharing</h2>
      <p>
        We do not sell, trade, or rent personal information to third parties. We may share data with:
      </p>
      <ul>
        <li>Infrastructure providers (hosting, CDN) as necessary to operate the Service</li>
        <li>Law enforcement if required by law</li>
      </ul>

      <h2>5. Data Retention</h2>
      <p>
        Click analytics data is retained for the lifetime of the associated link. When a link is deleted, its associated click data is also removed. Expired links are automatically removed by the system.
      </p>

      <h2>6. Your Rights</h2>
      <p>
        Depending on your jurisdiction, you may have the right to access, correct, or delete your personal data. Contact us at{" "}
        <a href="mailto:privacy@hmddevs.org">privacy@hmddevs.org</a> to exercise these rights.
      </p>

      <h2>7. Security</h2>
      <p>
        We implement industry-standard security measures, including encrypted connections (HTTPS), hashed passwords, and access controls to protect your data.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date.
      </p>

      <h2>9. Contact</h2>
      <p>
        For privacy inquiries, email us at{" "}
        <a href="mailto:privacy@hmddevs.org">privacy@hmddevs.org</a>.
      </p>
    </>
  );
}
