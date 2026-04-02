import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "HMD.bio Cookie Policy",
};

export default function CookiePage() {
  return (
    <>
      <h1>Cookie Policy</h1>
      <p className="text-sm text-gray-500">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

      <h2>1. What Are Cookies</h2>
      <p>
        Cookies are small text files stored on your device by your web browser. They are widely used to make websites work efficiently and to provide information to site owners.
      </p>

      <h2>2. Cookies We Use</h2>
      <table>
        <thead>
          <tr>
            <th>Cookie</th>
            <th>Purpose</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>next-auth.session-token</code></td>
            <td>Authentication session for admin panel</td>
            <td>Session / 30 days</td>
          </tr>
          <tr>
            <td><code>next-auth.csrf-token</code></td>
            <td>CSRF protection for authentication</td>
            <td>Session</td>
          </tr>
          <tr>
            <td><code>next-auth.callback-url</code></td>
            <td>Redirect URL after login</td>
            <td>Session</td>
          </tr>
          <tr>
            <td><code>data-theme</code></td>
            <td>Theme preference (light/dark)</td>
            <td>1 year</td>
          </tr>
        </tbody>
      </table>

      <h2>3. Third-Party Cookies</h2>
      <p>We may use the following third-party services that set their own cookies:</p>
      <ul>
        <li><strong>Cloudflare Turnstile</strong> — Bot protection on the shortening form</li>
        <li><strong>Vercel Analytics</strong> — Anonymous performance analytics</li>
      </ul>

      <h2>4. Managing Cookies</h2>
      <p>
        Most browsers allow you to control cookies through their settings. You can delete existing cookies and configure your browser to reject new ones. Note that disabling cookies may affect the functionality of the admin panel.
      </p>

      <h2>5. Contact</h2>
      <p>
        Questions about our use of cookies? Email{" "}
        <a href="mailto:privacy@hmddevs.org">privacy@hmddevs.org</a>.
      </p>
    </>
  );
}
