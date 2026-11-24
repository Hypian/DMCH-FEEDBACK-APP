# DMC Patient Feedback

## Neon setup

1. Create a Neon PostgreSQL project and copy its pooled connection string into a local `.env` file based on [`.env.example`](./.env.example). Replace both secret placeholders with independent random values of at least 32 characters. Keep the connection string and secrets server-only; never put them in browser JavaScript.
2. Set `BETTER_AUTH_URL` to the origin that serves this app. Locally, with the default port, use `http://localhost:5173`. Configure the production URL before deployment.
3. Install dependencies with `npm install`.
4. Create/update Better Auth's tables with `npm run auth:migrate`. The username plugin adds the username field.
5. Run [`backend/neon/schema.sql`](./backend/neon/schema.sql) in the Neon SQL editor after the Better Auth migration and before signup. It creates feedback, department, admin-allowlist, account-approval, device-lock, alerting, and audit tables.
6. Run `npm run db:migrate` (or execute [`backend/neon/all-migrations.sql`](./backend/neon/all-migrations.sql) in the Neon SQL editor). This idempotently applies all schema updates — including optional `phone`, stable `username` backfills for legacy accounts, role tables, audit logs, alerting tables, and account deactivation constraints. If upgrading legacy Better Auth accounts, query `select id, name, username from public."user";` and securely share assigned usernames.
7. From the project root, start the local Node server with `npm start` (or run the local Cloudflare Worker runtime with `npm run dev` after copying [`.dev.vars.example`](./.dev.vars.example) to `.dev.vars`), and open the printed local URL over HTTP. Do not open the HTML files directly or use Live Server, since those methods do not run the backend API.

## Project layout

- `frontend/` contains the static HTML pages, browser JavaScript, CSS, image assets, and Cloudflare static asset security headers (`frontend/_headers`).
- `worker/` contains the Cloudflare Workers entrypoint (`worker/index.mjs`) handling `/api/*`, `/webhooks/*`, static asset fallback (`ASSETS`), and the 5-minute alert/escalation cron trigger.
- `backend/` contains the Neon database API, Better Auth setup, sentiment/alerting services, and SQL schema/migrations.
- `server/` contains the Node HTTP server used for local development (`npm start`) and automated tests.
- `wrangler.jsonc`, `.env.example`, `.dev.vars.example`, and `package.json` stay at the project root; run npm commands from there.

## Deploy the app on Cloudflare Workers

Cloudflare Workers runs the backend API, scheduled alert cron (`*/5 * * * *`), and serves the static `frontend/` assets from the same HTTPS origin; Neon remains the PostgreSQL database. The repository includes [`wrangler.jsonc`](./wrangler.jsonc), which configures `worker/index.mjs`, `nodejs_compat`, Smart Placement, logs/traces observability, and the `ASSETS` binding for `./frontend`.

### 1. Connect & deploy

Choose any of these deployment paths:

- **Cloudflare Workers Git integration (recommended):** In the [Cloudflare Dashboard](https://dash.cloudflare.com/), open **Workers & Pages**, connect `Hypian/DMCH-FEEDBACK-APP` (`main` branch), and use `npx wrangler deploy` as the deploy command.
- **Wrangler CLI:** Authenticate once (`npx wrangler login`), validate the bundle with `npm run cf:dry-run`, and deploy with `npm run deploy`.
- **GitHub Actions (manual trigger):** Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to repository **Settings → Secrets and variables → Actions**, then run the **Deploy Cloudflare Worker** workflow from the **Actions** tab.

### 2. Configure variables and secrets

Non-secret production defaults (`BETTER_AUTH_URL`, `FRONTEND_ORIGIN`, `SMS_PROVIDER`, `GEMINI_MODEL`, `REDACT_BEFORE_LLM`, escalation intervals, and `ALERT_INCLUDE_EXCERPT`) are committed in [`wrangler.jsonc`](./wrangler.jsonc). Update `BETTER_AUTH_URL` and `FRONTEND_ORIGIN` there if you attach a custom domain.

Set all sensitive values as encrypted Worker secrets (via the Cloudflare Dashboard under **Settings → Variables and Secrets**, or with `npx wrangler secret put <NAME>`):

- **Required:**
  - `NEON_DATABASE_URL` — pooled Neon PostgreSQL connection string.
  - `BETTER_AUTH_SECRET` — random secret of at least 32 characters.
  - `DMC_DEVICE_HASH_SECRET` — independent random secret of at least 32 characters.
- **AI & Alerting (production):**
  - `GEMINI_API_KEY` — Google Gemini API key for sentiment/urgency analysis.
  - `ALERTS_DRY_RUN` — set to `false` in production to send live SMS/email alerts (defaults to dry-run if unset).
  - `INTOUCH_SMS_USERNAME`, `INTOUCH_SMS_PASSWORD`, `INTOUCH_SMS_SENDER` — InTouch SMS Rwanda credentials.
  - `RESEND_API_KEY` & `EMAIL_FROM` — HTTPS email delivery via Resend (raw SMTP sockets used by Nodemailer are unavailable on Cloudflare Workers).
  - `ALERT_FALLBACK_PHONE`, `ALERT_FALLBACK_EMAIL` — fallback duty-manager routing.
  - `CRON_SECRET` — shared secret for manual `/api/cron/process-alerts` triggers.

### 3. Local Worker development & verification

1. Copy [`.dev.vars.example`](./.dev.vars.example) to `.dev.vars` (gitignored) and fill in your development secrets. `.dev.vars` overrides `BETTER_AUTH_URL` and `FRONTEND_ORIGIN` to `http://localhost:8787` so local cookies work over HTTP.
2. Start the local Worker with `npm run dev`.
3. After deploying, verify `https://feedback.dreammedicalcenter.rw/api/health` (or `https://dmch-feedback-app.dmc-resto-mis.workers.dev/api/health`) returns `{"ok":true,"service":"dmch-feedback-app","runtime":"cloudflare-workers"}` and `/api/departments` returns JSON. Stream live production logs anytime with `npm run cf:tail`.

Do not copy local `.env` or `.dev.vars` files into GitHub, commit them, or expose database credentials in `frontend/` static files. GitHub Pages remains a separate static deployment and will not reach the Cloudflare Worker API until `DMC_API_ORIGIN` is configured for its Pages workflow.

## Account approval and first administrator

New signups are recorded as `pending`. Users sign up and log in with full name, username, and password, then wait for a supreme administrator's approval before accessing protected account features. To promote Sandra, retrieve her Better Auth user ID in Neon and promote her once:

```sql
select id, name, username from public."user" where username = 'SANDRA_USERNAME';
begin;
insert into public.feedback_admins (user_id) values ('SANDRA_BETTER_AUTH_USER_ID');
update public.feedback_account_approvals
set status = 'approved', reviewed_at = now(), reviewed_by = 'SANDRA_BETTER_AUTH_USER_ID'
where user_id = 'SANDRA_BETTER_AUTH_USER_ID';
commit;
```

Sandra signs in with her username and the strong password she chooses. The provided passcode was shared in chat and is weak; it is deliberately not embedded or seeded. After confirming Sandra is the intended owner, grant the supreme-admin role using her exact Better Auth user ID:

```sql
insert into public.feedback_supreme_admins (user_id)
values ('SANDRA_BETTER_AUTH_USER_ID');
```

Any approved account can open the dashboard and view its analytics, feedback records, service list, activity log, and exports. These accounts have read-only access and do not see the **User Management** tab. Admins can also open User Management, which lists all registered accounts (including pending accounts), approved accounts, and the authorized admin directory. Supreme admins can approve or decline pending accounts and grant or remove admin and supreme-admin access. The backend restricts account and role changes to supreme admins, and other dashboard changes to admins. The app prevents removing the last admin or last supreme admin. **Feedback Records** updates automatically while the dashboard is open and lets admins delete individual feedback records; the existing clear-all control remains available. **Activity Log** records successful sign-ins, account approvals and role changes, feedback submissions and deletions, service changes, demo-data actions, and report exports. **Export Center** downloads premium XLSX workbooks with the DMC logo, an executive summary, formatted report tables, and color-coded performance indicators. Applying the schema and supreme-admin migration is required before using user-management features; existing installations must also apply the audit-log migration before deploying this version.

Better Auth's underlying user model requires an email-shaped identifier. The app generates it server-side from the username using the reserved `accounts.dmc.invalid` domain; users do not provide or use email addresses, and no verification or recovery email is sent. Existing email values remain in their existing account rows but are not used for login or shown in the UI. Password recovery is not available; users must keep their password safe.

## GitHub Pages

The Pages workflow publishes the contents of `frontend/` as the site root, so `/DMCH-FEEDBACK-APP/` has an `index.html` instead of a 404. In repository **Settings → Pages**, choose **GitHub Actions** as the source. GitHub Pages only hosts static files; it does not run the backend API. Deploy the Cloudflare Worker (which already serves `frontend/` and `/api/*` together from one origin), or if using GitHub Pages separately, add the repository Actions variable `DMC_API_ORIGIN` with the Worker's HTTPS origin (scheme and host only, no path), configure `FRONTEND_ORIGIN=https://hypian.github.io` on the Worker, and redeploy Pages.

The frontend and API are cross-site on the default GitHub Pages domain. The app configures credentialed CORS and partitioned secure cookies for this deployment, but browser privacy settings can still block cross-site authentication. For reliable sessions, use a custom domain with frontend and API on the same site (for example, `feedback.example.com` and `api.example.com`) or host both together. Until the API is deployed and `DMC_API_ORIGIN` is configured, Pages will show the static site but database, signup, and login requests cannot work.

Only Neon is used by the running application. Supabase client files and SQL migrations have been removed from this repository. As requested, the hosted Supabase project and its data have **not** been changed or deleted. Existing Supabase feedback is not copied into Neon automatically.

## Create an additional administrator

Sign up at `signup.html` with full name, username, and password. Usernames are 3–30 letters, numbers, periods, or underscores, and are normalized to lowercase. A new account is not an administrator by default.

Supreme admins can grant dashboard access from **User Management** after signup. Alternatively, look up the Better Auth user ID by username, then add that exact ID to the allowlist and mark the account approved:

```sql
select id, name, username from public."user" where username = 'admin_username';
begin;
insert into public.feedback_admins (user_id) values ('BETTER_AUTH_USER_ID');
update public.feedback_account_approvals
set status = 'approved', reviewed_at = now(), reviewed_by = 'BETTER_AUTH_USER_ID'
where user_id = 'BETTER_AUTH_USER_ID';
commit;
```

All approved users can view the dashboard; admin allowlisting is required for User Management and write operations. Supreme-admin membership is separate from dashboard access, and only an existing supreme admin can approve accounts or change roles in the app. The database connection remains server-side (Cloudflare Worker / local Node server); browser requests do not contain Neon credentials.

## Behavior and data notes

- Patients can submit feedback anonymously. If a patient is signed in, the response is associated with their Better Auth user ID; the survey explains this before submission. `/api/my-responses` only queries that user's rows. Admin access uses a separate allowlist.
- A device UUID is stored in browser local storage and is HMAC-hashed server-side for the 24-hour submission limit.
- The app accesses tables through server-side parameterized SQL; do not expose these tables through Neon Data API without adding and testing appropriate RLS policies.
- Supabase is retained remotely by your choice. Export and import any needed old responses separately before retiring that project.

## Manual auth test plan

1. Create an account with full name, username, and password; confirm the themed dialog says to wait for administrator approval. Test invalid fields and a duplicate username.
2. Try signing in before approval; the account should be signed out again and shown a pending-approval dialog.
3. Sign Sandra in, open the default User Management tab, approve the pending test account, then verify that account can sign in.
4. Reject another test account and verify it cannot sign in to protected features.
5. Refresh an approved session to confirm persistence; sign out and verify protected admin routes return to login.
6. Submit one survey twice from the same browser within 24 hours; the second submission should be rejected.

## Automated checks

```sh
npm test
```
