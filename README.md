# DMC Patient Feedback

## Neon setup

1. Create a Neon PostgreSQL project and copy its pooled connection string into a local `.env` file based on [`.env.example`](./.env.example). Replace both secret placeholders with independent random values of at least 32 characters. Keep the connection string and secrets server-only; never put them in browser JavaScript.
2. Set `BETTER_AUTH_URL` to the origin that serves this app. Locally, with the default port, use `http://localhost:5173`. Configure the production URL before deployment.
3. Install dependencies with `npm install`. If the existing Better Auth `user` table has the legacy required `phone` column, run [`backend/neon/phone-optional-migration.sql`](./backend/neon/phone-optional-migration.sql) in the Neon SQL editor first. It preserves existing phone values while allowing new accounts that no longer collect phone numbers.
4. Create/update Better Auth's tables with `npm run auth:migrate`. The username plugin adds the username field.
5. Run [`backend/neon/schema.sql`](./backend/neon/schema.sql) in the Neon SQL editor after the Better Auth migration and before signup. It creates feedback, department, admin-allowlist, account-approval, device-lock, and audit tables.
6. If you already have Better Auth accounts, run [`backend/neon/username-auth-migration.sql`](./backend/neon/username-auth-migration.sql). It safely ensures the username column and unique index exist, then assigns stable usernames without changing account IDs or password hashes. Query `select id, name, username from public."user";` and securely tell each existing user their assigned username. Review the migration before running it.
7. Run [`backend/neon/supreme-admin-migration.sql`](./backend/neon/supreme-admin-migration.sql) to create the separate supreme-admin role table before using user management.
8. For an existing installation, run [`backend/neon/audit-log-migration.sql`](./backend/neon/audit-log-migration.sql) once to create the application audit table.
8. From the project root, start with `npm start`; open the printed local URL over HTTP. Do not open the HTML files directly or use Live Server, since those methods do not run the backend API.

## Project layout

- `frontend/` contains the static HTML pages, browser JavaScript, CSS, and image assets.
- `backend/` contains the Neon database API, Better Auth setup, and SQL schema.
- `server/` contains the Node HTTP server that serves `frontend/` and routes API requests to `backend/`.
- `.env.example` and `package.json` stay at the project root; run npm commands from there.

## Deploy the app on Railway

Railway runs the Node server and serves the frontend from the same HTTPS origin; Neon remains the database. The repository includes [`railway.json`](./railway.json), which selects `npm ci`, starts the app with `npm start`, and checks `/api/departments` for readiness. Railway supplies `PORT`; the server listens on it.

1. Sign in at [Railway](https://railway.com/), create a project, and choose **Deploy from GitHub repo**. Connect `Hypian/DMCH-FEEDBACK-APP` and deploy the `main` branch from the repository root.
2. In the Railway service's **Settings → Networking**, generate a public domain. Copy its HTTPS origin, for example `https://your-service.up.railway.app`.
3. In the service's **Variables**, set:
   - `NEON_DATABASE_URL` — the Neon connection string (keep it private).
   - `BETTER_AUTH_SECRET` — a random secret of at least 32 characters.
   - `DMC_DEVICE_HASH_SECRET` — a separate random secret of at least 32 characters.
   - `BETTER_AUTH_URL` — the Railway HTTPS origin from step 2.
   - `FRONTEND_ORIGIN` — the same Railway HTTPS origin from step 2.
4. Save the variables and redeploy. Do not set `HOST` or `PORT`; Railway supplies the port, and the app listens on all interfaces by default.
5. Open the Railway HTTPS URL. Confirm the homepage loads, then check `https://your-service.up.railway.app/api/departments` returns JSON. Use that same Railway URL for signup and survey access.

Do not copy local `.env` files into GitHub, commit them, or put database credentials in Railway frontend/static files. GitHub Pages remains a separate static deployment and will not reach this Railway backend until `DMC_API_ORIGIN` is configured for its Pages workflow.

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

The dashboard's **User Management** tab is available to admins. It lists approved accounts and the authorized admin directory; supreme admins can also approve or decline pending accounts, grant or remove admin access, and grant or remove supreme-admin access. The backend restricts account and role management to supreme admins. The app prevents removing the last admin or last supreme admin. **Feedback Records** updates automatically while the dashboard is open and lets admins delete individual feedback records; the existing clear-all control remains available. **Activity Log** is available to every admin and records successful sign-ins, account approvals and role changes, feedback submissions and deletions, service changes, demo-data actions, and report exports. **Export Center** downloads CSV reports. Applying the schema and supreme-admin migration is required before using user-management features; existing installations must also apply the audit-log migration before deploying this version.

Better Auth's underlying user model requires an email-shaped identifier. The app generates it server-side from the username using the reserved `accounts.dmc.invalid` domain; users do not provide or use email addresses, and no verification or recovery email is sent. Existing email values remain in their existing account rows but are not used for login or shown in the UI. Password recovery is not available; users must keep their password safe.

## GitHub Pages

The Pages workflow publishes the contents of `frontend/` as the site root, so `/DMCH-FEEDBACK-APP/` has an `index.html` instead of a 404. In repository **Settings → Pages**, choose **GitHub Actions** as the source. GitHub Pages only hosts static files; it does not run the Node server. Deploy the Node API separately, then add the repository Actions variable `DMC_API_ORIGIN` with its HTTPS origin (scheme and host only, no path). Configure the API host's `.env` with `BETTER_AUTH_URL` set to that API origin and `FRONTEND_ORIGIN=https://hypian.github.io`, then redeploy Pages.

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

Only allowlisted users can use admin endpoints. Supreme-admin membership is separate from dashboard access and only an existing supreme admin can change roles in the app. The database connection remains on the Node server; browser requests do not contain Neon credentials.

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
