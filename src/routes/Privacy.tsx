export default function Privacy() {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h1 className="text-base font-semibold text-slate-700">Privacy Notice (GDPR)</h1>
          <p className="mt-1 text-xs text-slate-500">Effective date: March 7, 2026</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm leading-relaxed text-slate-600">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">1) Controller</h2>
        <p className="mt-2">Diego Giorgini ("we", "us")</p>
        <p>
          Contact:{' '}
          <a
            href="mailto:privacy@diegobit.com"
            className="text-sky-700 underline decoration-sky-300 underline-offset-2"
          >
            privacy@diegobit.com
          </a>
        </p>
        <p>Location: Italy</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">2) What this app does</h2>
        <p className="mt-2">
          Rivolo is a local-first notes app. By default, notes and settings are stored in your browser on your
          device.
        </p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">3) Personal data we process</h2>
        <div className="mt-2 space-y-2">
          <p>
            <span className="font-semibold text-slate-700">A) Local app data (on your device)</span>
            <br />
            Notes content, app settings/preferences, and sync status metadata.
          </p>
          <p>
            <span className="font-semibold text-slate-700">B) Hosting/security data (Cloudflare)</span>
            <br />
            Technical request data such as IP address, user agent/browser info, URL, date/time, and related
            security/performance metadata.
          </p>
          <p>
            <span className="font-semibold text-slate-700">C) Optional AI feature (Google Gemini)</span>
            <br />
            If you use AI features, we send your prompt and relevant notes context needed to answer.
          </p>
          <p>
            <span className="font-semibold text-slate-700">D) Optional Dropbox sync</span>
            <br />
            If you connect Dropbox, we process Dropbox auth/session data (tokens and basic account metadata) and notes
            data you choose to sync.
          </p>
        </div>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          4) Purposes and legal bases (GDPR Art. 6)
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Provide and secure the app (including hosting/CDN via Cloudflare): Art. 6(1)(f) legitimate interests.
          </li>
          <li>Gemini AI feature (optional): Art. 6(1)(a) consent.</li>
          <li>Dropbox sync (optional): Art. 6(1)(a) consent.</li>
        </ul>
        <p className="mt-2">You can use Rivolo without enabling Gemini or Dropbox.</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">5) Recipients</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Cloudflare (hosting/CDN/security)</li>
          <li>Google (Gemini API)</li>
          <li>Dropbox (sync provider)</li>
        </ul>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">6) International transfers</h2>
        <p className="mt-2">
          These providers may process data outside the EU/EEA/UK. Where applicable, transfers rely on appropriate
          safeguards under GDPR (for example, adequacy decisions and/or standard contractual clauses as provided by the
          vendor).
        </p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">7) Retention</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Local app data: kept on your device until you delete it or clear site/browser storage.</li>
          <li>Cloudflare technical/security data: retained per operational/security configuration.</li>
          <li>Gemini/Dropbox data: subject to those providers' retention practices and your account settings.</li>
        </ul>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">8) Your GDPR rights</h2>
        <p className="mt-2">
          You may have rights to access, rectify, erase, restrict, and port your data, and to object to processing
          based on legitimate interests.
        </p>
        <p className="mt-2">
          Where processing is based on consent (optional Gemini/Dropbox features), you can withdraw consent at any
          time.
        </p>
        <p className="mt-2">
          To exercise rights, contact:{' '}
          <a
            href="mailto:privacy@diegobit.com"
            className="text-sky-700 underline decoration-sky-300 underline-offset-2"
          >
            privacy@diegobit.com
          </a>
          .
        </p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">9) Right to complain</h2>
        <p className="mt-2">You can lodge a complaint with your local data protection supervisory authority.</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          10) Automated decision-making
        </h2>
        <p className="mt-2">We do not use automated decision-making that produces legal or similarly significant effects.</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">11) Changes</h2>
        <p className="mt-2">We may update this notice from time to time and will update the effective date above.</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Third-party privacy links</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <a
              href="https://www.cloudflare.com/privacy/"
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 underline decoration-sky-300 underline-offset-2"
            >
              Cloudflare Privacy Policy
            </a>
          </li>
          <li>
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 underline decoration-sky-300 underline-offset-2"
            >
              Google Privacy Policy
            </a>
          </li>
          <li>
            <a
              href="https://www.dropbox.com/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 underline decoration-sky-300 underline-offset-2"
            >
              Dropbox Privacy Policy
            </a>
          </li>
        </ul>
      </section>
    </div>
  )
}
