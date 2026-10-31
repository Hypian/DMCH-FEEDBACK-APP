# Meta WhatsApp Business Message Templates

This document details the exact templates to submit for approval in **Meta Business Manager** (WhatsApp Manager > Message Templates).

All business-initiated conversations on the WhatsApp Business Cloud API require pre-approved templates. To maintain strict patient confidentiality, **no patient names, phone numbers, medical diagnoses, or verbatim feedback text** are included in any template.

---

## Language & Submission Defaults
* **Category**: `UTILITY` (Service & Operational Notifications)
* **Default Template Language**: `en_US` (English - US)
* **Meta Supported Language Codes**:
  * English (US): `en_US`
  * French: `fr`
  * Kinyarwanda: *(Not natively supported by Meta for utility template validation; Meta uses `en` or `fr` as primary fallback in Rwanda)*. Default to `en_US` for all staff notifications.

---

## Template 1: Urgent Feedback Alert (`urgent_feedback_alert`)

Use this template to dispatch immediate notifications when patient feedback is classified as **critical** or **high** severity needing attention.

* **Template Name**: `urgent_feedback_alert`
* **Category**: `UTILITY`
* **Language**: `en_US`
* **Header**: None

### Body Text
```text
DMC Hospital Alert: New patient feedback requiring attention has been registered.

* Severity: {{1}}
* Department: {{2}}
* Language: {{3}}
* Flagged Reason: {{4}}

Please open the authenticated staff dashboard to review details and take necessary action:
{{5}}
```

### Sample Parameter Values (for Meta submission):
1. `CRITICAL`
2. `Maternity & Neonatal`
3. `EN`
4. `Reported urgent clinical concern`
5. `https://hypian.github.io/index.html#admin`

### Quick-Reply Buttons (Optional but recommended):
* **Button Type**: Quick Reply
* **Button 1 Text**: `Acknowledge`
* **Payload**: `ack_feedback`

---

## Template 2: Feedback Escalation (`feedback_escalation`)

Dispatched to the Duty Manager or departmental lead when a critical or high-severity alert remains unacknowledged past the configured escalation window.

* **Template Name**: `feedback_escalation`
* **Category**: `UTILITY`
* **Language**: `en_US`
* **Header**: None

### Body Text
```text
DMC Hospital Escalation: Unacknowledged patient feedback alert for {{1}} minutes.

* Severity: {{2}}
* Department: {{3}}
* Language: {{4}}
* Flagged Reason: {{5}}

Immediate supervisory attention requested. Review on the secure staff dashboard:
{{6}}
```

### Sample Parameter Values (for Meta submission):
1. `15`
2. `CRITICAL`
3. `Pediatrics Emergency`
4. `RW`
5. `Reported urgent clinical concern`
6. `https://hypian.github.io/index.html#admin`

### Quick-Reply Buttons:
* **Button Type**: Quick Reply
* **Button 1 Text**: `Acknowledge`
* **Payload**: `ack_feedback`

---

## Template 3: Periodic Feedback Digest (`feedback_digest`)

Dispatched to hospital leadership or quality officers as a batched hourly or daily summary of flagged feedback across departments.

* **Template Name**: `feedback_digest`
* **Category**: `UTILITY`
* **Language**: `en_US`
* **Header**: None

### Body Text
```text
DMC Hospital Quality Digest: Summary of flagged patient feedback for {{1}}.

* Department Summary: {{2}}
* Total Pending Items: {{3}}

Access the analytics dashboard to review trends:
{{4}}
```

### Sample Parameter Values (for Meta submission):
1. `Today (08:00 - 12:00)`
2. `OPD: 2, Maternity: 1, Emergency: 1`
3. `4`
4. `https://hypian.github.io/index.html#admin`

---

## Meta Business Manager Submission Checklist
1. Log into [Meta Business Manager](https://business.facebook.com/) > **WhatsApp Accounts** > your account > **WhatsApp Manager**.
2. Navigate to **Account Tools** > **Message Templates**.
3. Click **Create Template**.
4. Select Category: **Utility**.
5. Copy and paste the template names and body text exactly as written above.
6. Provide the sample values specified above during template submission so Meta reviewers can verify parameter usage.
7. Approval typically takes 1 to 15 minutes for Utility templates.

