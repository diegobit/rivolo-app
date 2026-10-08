# Piano di Integrazione: Flusso Interattivo OAuth MCP (Consent Screen)

Questo documento descrive l'architettura, lo stato attuale e i passaggi futuri per completare l'esperienza di autenticazione interattiva OAuth 2.1 con **Schermata di Consenso (Consent Screen)** per il server MCP di Rivolo.

---

## 1. Spiegazione Semplice (Cosa fa e a cosa serve)

Oggi per collegare un agente AI a Rivolo (es. su Claude, Codex, OpenCode o Antigravity):
- L'utente deve aprire manualmente **`rivolo.app/settings` → Accesso Agente**, creare un *Personal Access Token* (`rvl_...`), copiarlo e incollarlo nei file di configurazione (`config.json`, `config.toml`, ecc.).

Con il **Flusso Interattivo OAuth (Consent Screen)**:
- L'utente apre il proprio client AI preferito (es. **Claude Desktop**, **Cursor**, **ChatGPT**, o qualsiasi client con supporto MCP standard).
- Inserisce unicamente l'indirizzo pubblico del server:  
  `https://mcp.rivolo.app/mcp` (senza dover inserire token a mano).
- Il client contatta Rivolo ed apre automaticamente una finestra nel browser:
  > **"L'applicazione Claude Desktop richiede l'accesso alle tue note su Rivolo:"**  
  > • Leggere le note giornaliere (`notes:read`)  
  > • Aggiungere appunti alle note (`notes:write`)  
  >  
  > *Account collegato: `utente@example.com` (Dropbox / Google Drive)*  
  >  
  > `[ Rifiuta ]` &nbsp;&nbsp;&nbsp;&nbsp; `[ Consenti accesso ]`
- L'utente clicca **Consenti**:
  - Il browser rimanda l'autorizzazione al client AI tramite un codice monouso sicuro (PKCE S256).
  - Il client riceve in automatico le credenziali di accesso (`rva_...`) e un refresh token per il rinnovo trasparente.
  - L'utente non deve mai copiare o manipolare token tecnici.

---

## 2. Stato Attuale dell'Implementazione in Rivolo

L'infrastruttura backend e il database D1 sono **già predisposti e operativi in produzione**:

1. **Database D1 (`rivolo-mcp`):**
   - `mcp_oauth_clients`: Registrazione dinamica dei client (DCR - RFC 7591) con redirect URI sicuri (HTTPS / loopback HTTP per app desktop).
   - `mcp_oauth_authorization_codes`: Codici di autorizzazione temporanei con protezione PKCE (RFC 7636).
   - `mcp_oauth_token_families` & `mcp_oauth_token_grants`: Gestione delle famiglie di token e rotazione crittografica automatica dei refresh token (Refresh Token Rotation).
   - Revoca a cascata se il profilo provider (Dropbox/Google Drive) viene revocato o disconnesso.

2. **Endpoint Pubblici (Cloudflare Pages Functions):**
   - `GET /.well-known/oauth-authorization-server/api/mcp/oauth`: Metadata server di autorizzazione (RFC 8414).
   - `GET /.well-known/oauth-protected-resource/mcp`: Metadata risorsa protetta MCP (RFC 9728).
   - `POST /api/mcp/oauth/register`: Dynamic Client Registration (DCR).
   - `GET /api/mcp/oauth/authorize`: Endpoint di consenso (mostra la schermata HTML).
   - `POST /api/mcp/oauth/authorize`: Endpoint di sottomissione consenso (approvazione / rifiuto).
   - `POST /api/mcp/oauth/token`: Emissione e rotazione token di accesso/refresh.
   - `POST /api/mcp/oauth/revoke`: Revoca esplicita dei token emessi.

3. **Autenticazione nel Worker MCP (`rivolo-mcp`):**
   - Riconoscimento immediato del prefisso token:
     - `rva_...` -> Autenticazione OAuth (verifica firma, scadenza, audience e associazione al profilo).
     - `rvl_...` -> Autenticazione con Personal Access Token.

---

## 3. Passaggi Futuri per il Rollout Pubblico Completo

Per rendere il flusso fruibile senza frizioni a qualsiasi utente finale e a client di terze parti, i passaggi da eseguire sono i seguenti:

### Fase 1: Gestione Sessione Browser Non Autenticata
- **Situazione attuale:** `showOAuthConsent` controlla se esiste già un cookie di sessione attivo (`readActiveMcpProfileSession`). Se l'utente apre il link da un browser in incognito o da un browser diverso da quello in cui usa Rivolo, riceve un messaggio che lo invita ad aprire Rivolo Settings.
- **Miglioramento futuro:**
  - Se la sessione manca, salvare la richiesta di autorizzazione pendente (client_id, redirect_uri, code_challenge, state) in un cookie firmato o parametro di ritorno.
  - Reindirizzare l'utente alla schermata di connessione/login di Rivolo.
  - Una volta effettuato l'accesso o confermata la connessione Dropbox/Google Drive, reindirizzare automaticamente l'utente alla schermata di consenso OAuth per completare l'operazione in un solo passaggio fluido.

### Fase 2: Rifinitura UI/UX della Schermata di Consenso
- La pagina di consenso attuale è generata via SSR HTML minimale (`functions/_lib/mcpOAuthHttp.ts`).
- **Miglioramenti grafici e di accessibilità:**
  - Applicare il design system nativo di Rivolo (font, colori, dark mode coerente con l'app, logo Rivolo vettoriale).
  - Dettagliare in modo chiaro i permessi richiesti:
    - 📖 **Lettura note:** per rispondere alle tue domande consultando il tuo storico.
    - ✍️ **Scrittura note:** per aggiungere nuovi appunti o to-do alle tue giornate.
  - Se l'utente ha configurato più profili o cartelle, consentire la selezione del profilo di destinazione prima di premere Consenti.

### Fase 3: Protezione Edge Cloudflare (WAF & Rate Limiting)
- Come documentato in `docs/mcp-oauth.md`, l'endpoint di Dynamic Client Registration (`/api/mcp/oauth/register`) consente a client pubblici di registrarsi.
- **Configurazioni Cloudflare raccomandate prima del rilascio pubblico:**
  - Regola di Rate Limiting su `/api/mcp/oauth/register` (es. max 10 registrazioni per IP all'ora) per prevenire spam sul DB D1.
  - Regola di Rate Limiting su `/api/mcp/oauth/token` (es. max 60 richieste al minuto per IP) per mitigare tentativi di brute-force o replay di refresh token.

### Fase 4: Matrice di Test Client-Side e Compatibilità
- Collaudo con i principali client MCP che supportano OAuth nativo:
  - **Claude Desktop:** configurazione con transport HTTP / SSE e flusso di login interattivo.
  - **Cursor IDE:** aggiunta MCP server remoto e verifica dell'handshake OAuth.
  - Verifica della rotazione automatica del refresh token dopo 30 giorni di inattività o durante sessioni prolungate.
