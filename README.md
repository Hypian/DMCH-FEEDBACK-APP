# DMC Patient Feedback

## Neon setup

1. Create a Neon PostgreSQL project and copy its pooled connection string into a local `.env` file based on [`.env.example`](./.env.example). Replace both secret placeholders with independent random values of at least 32 characters. Keep the connection string, SMTP password, and secrets server-only; never put them in browser JavaScript.
2. Set `BETTER_AUTH_URL` to the origin that serves this app. Locally, with the default port, use `http://localhost:5173`. Configure the production URL before deployment.
3. Install dependencies with `npm install`, then create Better Auth's tables with `npm run auth:migrate`. Review the migration output before applying it. This command requires `NEON_DATABASE_URL` and `BETTER_AUTH_SECRET`.
4. Run [`backend/neon/schema.sql`](./backend/neon/schema.sql) in the Neon SQL editor after the Better Auth migration. It creates feedback, department, admin-allowlist, and device-lock tables.
5. Configure SMTP variables in `.env` to enable signup verification and password-reset emails. Email flows fail visibly if SMTP is not configured; the app does not log email tokens or passwords.
6. From the project root, start with `npm start`; open the printed local URL over HTTP. Do not open the HTML files directly or use Live Server, since those methods do not run the backend API.

## Project layout

- `frontend/` contains the static HTML pages, browser JavaScript, CSS, and image assets.
- `backend/` contains the Neon database API, Better Auth setup, and SQL schema.
- `server/` contains the Node HTTP server that serves `frontend/` and routes API requests to `backend/`.
- `.env.example` and `package.json` stay at the project root; run npm commands from there.

Only Neon is used by the running application. Supabase client files and SQL migrations have been removed from this repository. As requested, the hosted Supabase project and its data have **not** been changed or deleted. Existing Supabase feedback is not copied into Neon automatically.

## Create an administrator

Sign up at `signup.html` with full name, phone number, email, and password. Confirm the email. A new account is not an administrator by default.

To grant dashboard access, find the Better Auth user ID and email, then add that exact ID to the allowlist:

```sql
select id, email from public."user" where email = 'admin@example.com';
insert into public.feedback_admins (user_id) values ('BETTER_AUTH_USER_ID');
```

Only allowlisted users can use admin endpoints. The database connection remains on the Node server; browser requests do not contain Neon credentials.

## Behavior and data notes

- Patients can submit feedback anonymously. If a patient is signed in, the response is associated with their Better Auth user ID; the survey explains this before submission. `/api/my-responses` only queries that user's rows. Admin access uses a separate allowlist.
- A device UUID is stored in browser local storage and is HMAC-hashed server-side for the 24-hour submission limit.
- The app accesses tables through server-side parameterized SQL; do not expose these tables through Neon Data API without adding and testing appropriate RLS policies.
- Supabase is retained remotely by your choice. Export and import any needed old responses separately before retiring that project.

## Manual auth test plan

1. Create an account and test name, phone, invalid email, weak password, and password-confirmation errors.
2. Confirm the email using SMTP; verify an unconfirmed account cannot sign in.
3. Sign in, refresh the page to confirm the HttpOnly session persists, and check that the admin header displays the email.
4. Open `index.html#admin` while logged out; confirm redirect to login. Sign in with a non-allowlisted user and verify admin data is denied; then allowlist that user and retry.
5. Sign out from the dashboard; reopen the admin route and confirm it redirects to login.
6. Request a password reset, use the email link, set a matching new password, and log in with it.
7. Submit one survey twice from the same browser within 24 hours; the second submission should be rejected.

## Automated checks

```sh
npm test
```
