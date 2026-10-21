# DMC Patient Feedback

## Neon setup

1. Create a Neon PostgreSQL project and copy its pooled connection string into a local `.env` file based on [`.env.example`](./.env.example). Replace both secret placeholders with independent random values of at least 32 characters. Keep the connection string, SMTP password, and secrets server-only; never put them in browser JavaScript.
2. Set `BETTER_AUTH_URL` to the origin that serves this app. Locally, with the default port, use `http://localhost:5173`. Configure the production URL before deployment.
3. Install dependencies with `npm install`, then create Better Auth's tables with `npm run auth:migrate`. Review the migration output before applying it. This command requires `NEON_DATABASE_URL` and `BETTER_AUTH_SECRET`.
4. Run [`backend/neon/schema.sql`](./backend/neon/schema.sql) in the Neon SQL editor after the Better Auth migration and before signup. It creates feedback, department, admin-allowlist, account-approval, and device-lock tables.
5. Configure SMTP variables in `.env` to enable signup verification and password-reset emails. Email flows fail visibly if SMTP is not configured; the app does not log email tokens or passwords.
6. From the project root, start with `npm start`; open the printed local URL over HTTP. Do not open the HTML files directly or use Live Server, since those methods do not run the backend API.

## Project layout

- `frontend/` contains the static HTML pages, browser JavaScript, CSS, and image assets.
- `backend/` contains the Neon database API, Better Auth setup, and SQL schema.
- `server/` contains the Node HTTP server that serves `frontend/` and routes API requests to `backend/`.
- `.env.example` and `package.json` stay at the project root; run npm commands from there.

## Account approval and first administrator

New signups are recorded as `pending`. Users must verify their email and wait for an administrator's approval before their account can access protected account features. After Sandra signs up with her email and verifies it, retrieve her Better Auth user ID in Neon and promote her once:

```sql
select id, email from public."user" where email = 'SANDRA_EMAIL';
begin;
insert into public.feedback_admins (user_id) values ('SANDRA_BETTER_AUTH_USER_ID');
update public.feedback_account_approvals
set status = 'approved', reviewed_at = now(), reviewed_by = 'SANDRA_BETTER_AUTH_USER_ID'
where user_id = 'SANDRA_BETTER_AUTH_USER_ID';
commit;
```

Sandra signs in with her email (not a username) and the strong password she chooses. The provided passcode was shared in chat and is weak; it is deliberately not embedded or seeded. The dashboard's **User Management** tab lists pending requests and lets Sandra approve or decline them. Applying the updated [`backend/neon/schema.sql`](./backend/neon/schema.sql) is required before enabling signup approval.

## GitHub Pages

The Pages workflow publishes the contents of `frontend/` as the site root, so `/DMCH-FEEDBACK-APP/` has an `index.html` instead of a 404. In repository **Settings → Pages**, choose **GitHub Actions** as the source. GitHub Pages only hosts static files; it does not run the Node server. Deploy the Node API separately, then add the repository Actions variable `DMC_API_ORIGIN` with its HTTPS origin (scheme and host only, no path). Configure the API host's `.env` with `BETTER_AUTH_URL` set to that API origin and `FRONTEND_ORIGIN=https://hypian.github.io`, then redeploy Pages.

The frontend and API are cross-site on the default GitHub Pages domain. The app configures credentialed CORS and partitioned secure cookies for this deployment, but browser privacy settings can still block cross-site authentication. For reliable sessions, use a custom domain with frontend and API on the same site (for example, `feedback.example.com` and `api.example.com`) or host both together. Until the API is deployed and `DMC_API_ORIGIN` is configured, Pages will show the static site but database, signup, and login requests cannot work.

Only Neon is used by the running application. Supabase client files and SQL migrations have been removed from this repository. As requested, the hosted Supabase project and its data have **not** been changed or deleted. Existing Supabase feedback is not copied into Neon automatically.

## Create an additional administrator

Sign up at `signup.html` with full name, phone number, email, and password, and confirm the email. A new account is not an administrator by default.

To grant dashboard access, find the Better Auth user ID and email, then add that exact ID to the allowlist and mark the account approved:

```sql
select id, email from public."user" where email = 'admin@example.com';
begin;
insert into public.feedback_admins (user_id) values ('BETTER_AUTH_USER_ID');
update public.feedback_account_approvals
set status = 'approved', reviewed_at = now(), reviewed_by = 'BETTER_AUTH_USER_ID'
where user_id = 'BETTER_AUTH_USER_ID';
commit;
```

Only allowlisted users can use admin endpoints. The database connection remains on the Node server; browser requests do not contain Neon credentials.

## Behavior and data notes

- Patients can submit feedback anonymously. If a patient is signed in, the response is associated with their Better Auth user ID; the survey explains this before submission. `/api/my-responses` only queries that user's rows. Admin access uses a separate allowlist.
- A device UUID is stored in browser local storage and is HMAC-hashed server-side for the 24-hour submission limit.
- The app accesses tables through server-side parameterized SQL; do not expose these tables through Neon Data API without adding and testing appropriate RLS policies.
- Supabase is retained remotely by your choice. Export and import any needed old responses separately before retiring that project.

## Manual auth test plan

1. Create an account; confirm the themed dialog says to verify the email and wait for administrator approval. Test invalid signup fields too.
2. Confirm the email. Try signing in before approval; the account should be signed out again and shown a pending-approval dialog.
3. Sign Sandra in, open the default User Management tab, approve the pending test account, then verify that account can sign in.
4. Reject another test account and verify it cannot sign in to protected features.
5. Refresh an approved session to confirm persistence; sign out and verify protected admin routes return to login.
6. Request a password reset, use the email link, set a matching new password, and log in with it.
7. Submit one survey twice from the same browser within 24 hours; the second submission should be rejected.

## Automated checks

```sh
npm test
```
