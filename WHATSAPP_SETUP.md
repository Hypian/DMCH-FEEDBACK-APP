# DMC Hospital WhatsApp Alerts Integration & Setup Guide

This guide details how to configure, test, and maintain the automated WhatsApp alerting system for negative and critical patient feedback at DMC Hospital.

---

## 1. Architecture & Reliability Overview

```
Patient Submits Feedback (POST /api/submit)
           │
           ▼
Database Transaction (PostgreSQL)
 ├── Insert feedback_responses
 ├── Run needsAttention(feedback, sentiment) [alertRules.js]
 └── Insert alert_outbox rows (status: 'pending') [Outbox Pattern]
           │
      Transaction Committed (Zero Delay for Patient)
           │
           ├─► Serverless/Render: Immediate asynchronous dispatch (Promise.race 2s timeout)
           ├─► Background Worker: Process pending alerts (SELECT ... FOR UPDATE SKIP LOCKED)
           └─► Cron Fallback: GET /api/cron/process-alerts every minute
                    │
                    ▼
           Meta WhatsApp Cloud API (services/whatsapp.js)
           [Pre-approved Templates • NO Patient PII / Text]
```

### Key Guarantees:
1. **Zero Impact on Patient Submission**: Patient submissions NEVER block, fail, or wait on external WhatsApp network calls. All alert records are queued in the outbox in the same database transaction that commits the feedback.
2. **Strict Patient Confidentiality**: WhatsApp messages NEVER contain patient names, IDs, phone numbers, or verbatim comments. Only the department, severity, language, and an authenticated link to the hospital dashboard are transmitted.
3. **Idempotency**: Unique database constraint `(feedback_id, recipient_id)` prevents accidental duplicate messages.
4. **Retry Backoff**: Exponential retry schedule (1 min, 5 min, 15 min, 30 min, 60 min; max 5 attempts) before marking an alert as failed.
5. **Two-Way Webhooks**: Automatically tracks delivery (`sent` -> `delivered` -> `read` -> `acknowledged`). Staff can acknowledge alerts via quick-reply buttons, replying "OK", or directly in the Admin Dashboard.
6. **Automatic Escalation**: Unacknowledged critical alerts escalate to the Duty Manager after 15 minutes (or `ESCALATE_CRITICAL_MINUTES`).

---

## 2. Meta WhatsApp Cloud API Setup Steps

### Step 1: Create a Meta Developer App
1. Go to [developers.facebook.com](https://developers.facebook.com/) and log in with your hospital's Meta Business account.
2. Click **My Apps** > **Create App**.
3. Select **Other** > **Business** as the application type.
4. Set App Name to **DMC Hospital Feedback Alerts** and link it to your hospital's Business Portfolio.

### Step 2: Add WhatsApp Product
1. On the App Dashboard, find **WhatsApp** and click **Set up**.
2. Under **API Setup**:
   * Note your **Phone Number ID**. Set this in your environment as `WA_PHONE_NUMBER_ID`.
   * Under App Settings > Basic, locate your **App Secret**. Set this as `WA_APP_SECRET`.

### Step 3: Create a Permanent System User Access Token
*Do not use temporary 24-hour developer tokens in production.*
1. Go to [business.facebook.com/settings](https://business.facebook.com/settings).
2. Navigate to **Users** > **System Users** > click **Add**.
3. Name: `DMCH Alerts Dispatcher`, Role: `Admin`.
4. Click **Assign Assets**:
   * Under **Apps**, select `DMC Hospital Feedback Alerts` with full control.
   * Under **WhatsApp Accounts**, select your hospital's WhatsApp Business Account with full control.
5. Click **Generate New Token**:
   * Select permissions: `whatsapp_business_messaging`, `whatsapp_business_management`.
   * Set token expiration to **Never**.
6. Copy the generated token and store it as `WA_ACCESS_TOKEN`.

### Step 4: Configure Webhooks
1. In the Meta Developer App dashboard, go to **WhatsApp** > **Configuration**.
2. Under **Webhook**, click **Edit**:
   * **Callback URL**: `https://<your-backend-domain>/webhooks/whatsapp`
   * **Verify Token**: Choose a secret string (e.g. 32 random characters). Set the same string in `.env` as `WA_VERIFY_TOKEN`.
3. Click **Verify and Save**. Meta will send a `GET` request to verify the token.
4. Under **Webhook fields**, click **Manage** and subscribe to:
   * `messages` (for delivery receipts and quick-reply acknowledgements).

---

## 3. Database Migration

Run the migration script against your Neon / PostgreSQL database:
```bash
psql $NEON_DATABASE_URL -f backend/neon/whatsapp-alerts-migration.sql
```
This creates:
* `public.staff_alert_contacts`
* `public.alert_outbox`
* Necessary indexes and foreign key references.

---

## 4. Admin Dashboard Configuration

1. Log into the DMCH Admin Dashboard (`index.html#admin`).
2. Navigate to the **WhatsApp Contacts** tab (visible to Admin and Supreme Admin roles).
3. Click **Add Contact**:
   * Enter full name (e.g. `Sister Christine`).
   * Enter WhatsApp phone number in **E.164 format** (e.g. `+250788123456`).
   * Select department (or leave blank for hospital-wide duty pool).
   * Check **Duty Manager** if this staff member should receive hospital-wide critical alerts and escalations.
   * Check **WhatsApp Opt-In Consent** (required by telecommunication and Meta policies).
4. Click **Send Test Alert** to verify message construction.

---

## 5. Pre-Flight Checklist for Going Live

Before enabling live WhatsApp alerts in production, complete this manual verification checklist:

- [ ] **1. Meta Template Approval**:
  Submit the 3 templates in `WHATSAPP_TEMPLATES.md` (`urgent_feedback_alert`, `feedback_escalation`, `feedback_digest`) in Meta Business Manager and wait for approval status `APPROVED`.
- [ ] **2. Native Speaker Review of Severity Keywords**:
  Open `backend/severityKeywords.json`. Have a native Kinyarwanda speaker and French speaker review all flagged terms and variants marked with `TODO: Review by native speaker`.
- [ ] **3. Staff Consent / Opt-In**:
  Confirm that all registered staff members have given documented consent to receive operational alerts on their personal/work WhatsApp numbers.
- [ ] **4. Webhook Verification**:
  Confirm that `https://<your-backend-domain>/webhooks/whatsapp` returns `200` to Meta test webhooks and that `X-Hub-Signature-256` HMAC verification passes.
- [ ] **5. Fallback Phone**:
  Set `ALERT_FALLBACK_PHONE` in production to the hospital's central on-call or emergency dispatch phone number.
- [ ] **6. Go Live**:
  In your production environment (Render, Vercel, or VPS):
  * Set `ALERTS_DRY_RUN=false`
  * Set `ALERTS_ENABLED=true`
  * Restart the application server.

