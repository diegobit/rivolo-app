export default function Privacy() {
  return (
    <div className="space-y-4">
      <header className="px-3 pt-1">
        <h1 className="text-2xl font-bold tracking-normal text-slate-700">Privacy</h1>
        <p className="mt-1 text-xs text-slate-500">Effective date: July 4, 2026</p>
      </header>

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
            <span className="font-semibold text-slate-700">C) Optional AI feature</span>
            <br />
            If you invoke an AI feature, your browser sends your prompt and relevant notes context directly to the
            provider you selected: Google Gemini, Anthropic, OpenAI, or an OpenAI-compatible endpoint you configured.
            If enabled and supported, the selected provider may also process a native web-search request. Rivolo does
            not automatically send the request to a fallback provider. The request includes the locally stored
            credential needed to authenticate with that provider; Anthropic requests also use Anthropic's required
            direct-browser access opt-in header.
          </p>
          <p>
            <span className="font-semibold text-slate-700">D) Optional cloud sync</span>
            <br />
            If you connect Dropbox, Google Drive, or OneDrive, the selected provider processes the notes data you choose to
            sync. Daily files also contain line editor names and recorded edit dates, visible to people who
            can read the notebook folder. For these providers, a Cloudflare Pages Function exchanges and refreshes OAuth credentials using an
            encrypted HttpOnly cookie; note contents are transferred directly between your browser and the selected
            provider and do not pass through those functions. For live updates, a Cloudflare function uses
            your access token to verify access with the selected sync provider and issue a short-lived encrypted
            WebSocket ticket. The relay distributes day/file identifiers and revisions, never note text or author names.
            It stores the latest revision per file in a room identified by a hash of the folder identifier.
            The OneDrive migration registry retains source/destination identifiers, migration status and coordination
            leases so devices use the same daily notebook folder. It does not store note contents.
          </p>
          <p>
            <span className="font-semibold text-slate-700">E) Optional Agent access</span>
            <br />
            If you enable Agent access in Settings, Rivolo stores an encrypted copy of your cloud provider's refresh
            credential in Cloudflare D1 along with the selected notebook and access records. When a connected agent requests
            a read or write, Rivolo's hosted Worker processes the note text and returns the requested data to the agent.
            D1 keeps access and write-operation records. The notebook files stay with your sync provider.
            Microsoft's Files.ReadWrite.All permission can reach files beyond the notebook, including files shared with you.
            The hosted Worker uses it to read and write days in the OneDrive folder saved in your Agent access profile.
            Agent-written lines can show your Microsoft display name to people with access to that notebook.
          </p>
        </div>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          4) Cookies and browser storage
        </h2>
        <p className="mt-2">
          Rivolo does not use analytics, advertising, or profiling cookies. It uses one first-party technical cookie
          per provider, only when you explicitly connect Google Drive, Dropbox, or OneDrive. Agent access uses a separate
          technical cookie.
        </p>
        <div className="mt-2 space-y-2">
          <p>
            <span className="font-semibold text-slate-700">Cloud sync refresh cookies</span>
            <br />
            Names: <code className="break-all text-xs">rivolo_gdrive_refresh</code> (Google Drive),{' '}
            <code className="break-all text-xs">rivolo_dropbox_refresh</code> (Dropbox), and <code className="break-all text-xs">rivolo_onedrive_refresh</code> (OneDrive). Purpose: keep the sync
            connection working by obtaining new short-lived access tokens without repeatedly asking you to sign
            in. Contents: an OAuth refresh credential encrypted by Rivolo before storage. Duration: up to 400 days
            from its latest refresh, or earlier if you disconnect the provider, revoke access, the credential expires,
            or you clear browser data. Scope and protections: first-party, limited to{' '}
            <code className="break-all text-xs">/api/google-drive</code> or{' '}
            <code className="break-all text-xs">/api/dropbox</code>, or <code className="break-all text-xs">/api/onedrive</code> respectively, HttpOnly, Secure on HTTPS, and
            SameSite=Strict. They are not available to browser JavaScript and are not used for tracking or profiling.
          </p>
          <p>
            <span className="font-semibold text-slate-700">Agent access cookie</span>
            <br />
            The encrypted, first-party <code className="break-all text-xs">rivolo_mcp_profile</code> cookie identifies
            your Agent access profile in Settings and during agent authorization. It is HttpOnly and scoped to
            <code className="ml-1 break-all text-xs">/api/mcp</code>.
          </p>
          <p>
            <span className="font-semibold text-slate-700">Other technical browser storage</span>
            <br />
            IndexedDB stores the local notes database, chat history, settings, optional AI API keys, and sync
            metadata, daily sync baselines, migration recovery snapshots and pending event identifiers. Session storage temporarily holds Dropbox and OneDrive OAuth validation data and the timeline scroll
            position. Older versions also queued OneDrive event identifiers in local storage. Local storage holds the optional debug-logging preference and technical tab-coordination
            entries (a random per-tab identifier and a data-revision counter, with no notes content or personal
            data) that let multiple open Rivolo tabs agree which one runs sync. The PWA service
            worker uses browser cache storage for app files needed for offline use. These mechanisms are used only to
            provide requested app features and are not used to track you across websites.
          </p>
        </div>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          5) Purposes and legal bases (GDPR Art. 6)
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Provide and secure the app (including hosting/CDN via Cloudflare): Art. 6(1)(f) legitimate interests.
          </li>
          <li>Selected AI provider feature (optional): Art. 6(1)(a) consent.</li>
          <li>Dropbox, Google Drive, or OneDrive sync (optional): Art. 6(1)(a) consent.</li>
        </ul>
        <p className="mt-2">You can use Rivolo without configuring an AI provider or cloud sync.</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">6) Recipients</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Cloudflare (hosting/CDN/security and Google Drive/Dropbox/OneDrive OAuth credential exchange, and daily update events and OneDrive migration coordination)</li>
          <li>Google (Gemini API), Anthropic, or OpenAI, only when selected for an AI request</li>
          <li>The operator of an OpenAI-compatible endpoint you choose, only when that endpoint is selected</li>
          <li>Dropbox (sync provider)</li>
          <li>Google Drive (sync provider)</li>
          <li>Microsoft OneDrive (sync provider)</li>
          <li>Cloudflare and the agents you authorize (optional hosted Agent access)</li>
        </ul>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">7) International transfers</h2>
        <p className="mt-2">
          These providers may process data outside the EU/EEA/UK. Where applicable, transfers rely on appropriate
          safeguards under GDPR (for example, adequacy decisions and/or standard contractual clauses as provided by the
          vendor).
        </p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">8) Retention</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Local app data, including AI provider keys and configuration: kept on your device until you remove it or
            clear site/browser storage. AI keys and configuration are not synced through cloud providers or included
            in notes export.
          </li>
          <li>Cloudflare technical/security data: retained per operational/security configuration.</li>
          <li>
            Disabling Agent access removes the server's stored refresh credential and revokes the profile's personal tokens
            and agent authorizations. Data already returned to an agent is subject to that agent's retention practices.
          </li>
          <li>
            AI provider, custom endpoint, Dropbox, Google Drive, and OneDrive data: subject to the selected operator's retention
            practices and your account settings. Disconnecting Google Drive, Dropbox, or OneDrive clears that provider's refresh
            credential cookie. Google Drive and Dropbox also receive a revocation request. For OneDrive, remove
            the app grant in your Microsoft account settings to revoke consent.
          </li>
        </ul>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">9) Your GDPR rights</h2>
        <p className="mt-2">
          You may have rights to access, rectify, erase, restrict, and port your data, and to object to processing
          based on legitimate interests.
        </p>
        <p className="mt-2">
          Where processing is based on consent (optional AI/cloud-sync features), you can withdraw consent at any time
          by no longer using the feature and disconnecting or removing its credentials.
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

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">10) Right to complain</h2>
        <p className="mt-2">You can lodge a complaint with your local data protection supervisory authority.</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          11) Automated decision-making
        </h2>
        <p className="mt-2">We do not use automated decision-making that produces legal or similarly significant effects.</p>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">12) Changes</h2>
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
              href="https://www.anthropic.com/legal/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 underline decoration-sky-300 underline-offset-2"
            >
              Anthropic Privacy Policy
            </a>
          </li>
          <li>
            <a
              href="https://openai.com/policies/privacy-policy/"
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 underline decoration-sky-300 underline-offset-2"
            >
              OpenAI Privacy Policy
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
        <p className="mt-2">
          If you configure a custom endpoint, its operator's privacy, retention, security, and international-transfer
          terms apply. Rivolo cannot determine or control those practices.
        </p>
      </section>
    </div>
  )
}
