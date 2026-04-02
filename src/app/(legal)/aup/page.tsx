import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: "HMD.bio Acceptable Use Policy",
};

export default function AUPPage() {
  return (
    <>
      <h1>Acceptable Use Policy</h1>
      <p className="text-sm text-gray-500">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

      <h2>1. Purpose</h2>
      <p>
        This Acceptable Use Policy (&quot;AUP&quot;) outlines prohibited uses of the HMD.bio service. Violating this policy may result in immediate link removal and account suspension.
      </p>

      <h2>2. Prohibited Content</h2>
      <p>You may not create short links that redirect to content that:</p>
      <ul>
        <li>Is illegal in any applicable jurisdiction</li>
        <li>Contains or distributes malware, viruses, or other harmful software</li>
        <li>Is phishing or designed to steal credentials or personal information</li>
        <li>Promotes violence, terrorism, or hate speech</li>
        <li>Contains child sexual abuse material (CSAM)</li>
        <li>Infringes intellectual property rights</li>
        <li>Is deceptive, fraudulent, or misleading</li>
        <li>Contains unsolicited bulk messaging (spam)</li>
      </ul>

      <h2>3. Prohibited Activities</h2>
      <p>You may not:</p>
      <ul>
        <li>Attempt to gain unauthorized access to the Service or its infrastructure</li>
        <li>Use automated tools to create links in bulk without authorization</li>
        <li>Exploit the Service for DDoS amplification or other attacks</li>
        <li>Circumvent rate limits or security measures</li>
        <li>Impersonate others or misrepresent your affiliation</li>
        <li>Use the Service to track individuals without their consent</li>
      </ul>

      <h2>4. Enforcement</h2>
      <p>
        We reserve the right to investigate and take action against violations, including:
      </p>
      <ul>
        <li>Disabling or removing offending links without notice</li>
        <li>Suspending or terminating accounts</li>
        <li>Reporting illegal activity to law enforcement</li>
        <li>Cooperating with legal investigations</li>
      </ul>

      <h2>5. Reporting Abuse</h2>
      <p>
        To report a link that violates this policy, email{" "}
        <a href="mailto:abuse@hmddevs.org">abuse@hmddevs.org</a> with the short URL and a description of the issue.
      </p>

      <h2>6. Changes</h2>
      <p>
        We may update this AUP at any time. Continued use of the Service constitutes acceptance of the current policy.
      </p>
    </>
  );
}
