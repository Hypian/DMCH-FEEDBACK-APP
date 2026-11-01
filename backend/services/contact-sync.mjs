/**
 * contact-sync.mjs
 * Synchronizes user accounts with public.staff_alert_contacts so alerts classified
 * by Gemini AI (Clinical, Public Relations, Managing Director) are routed to users
 * via InTouch SMS.
 */

import { isValidIntouchPhone, isValidE164 } from './intouch.js';

/**
 * Normalizes any phone number input to E.164 format (+250...).
 * @param {string} rawPhone
 * @returns {string}
 */
export function normalizePhoneE164(rawPhone) {
  if (typeof rawPhone !== 'string') return '';
  let cleaned = rawPhone.replace(/[\s\-\(\)\.]/g, '').trim();
  if (cleaned.startsWith('07') && cleaned.length === 10) {
    return '+250' + cleaned.slice(1);
  }
  if (cleaned.startsWith('2507') && cleaned.length === 12) {
    return '+' + cleaned;
  }
  if (cleaned.startsWith('7') && cleaned.length === 9) {
    return '+250' + cleaned;
  }
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return cleaned;
  }
  return cleaned;
}

/**
 * Syncs a user account to the staff_alert_contacts directory.
 * @param {object} pool PostgreSQL connection pool
 * @param {object} user { userId, name, username, phone, category }
 * @returns {Promise<object|null>}
 */
export async function syncUserAlertContact(pool, user = {}) {
  const userId = user.userId || user.id;
  const rawPhone = user.phone;
  if (!userId || !rawPhone) return null;

  const e164Phone = normalizePhoneE164(rawPhone);
  if (!isValidIntouchPhone(e164Phone) && !isValidE164(e164Phone)) {
    console.warn(`[CONTACT SYNC] Skipping invalid phone for user ${userId}: ${rawPhone}`);
    return null;
  }

  const validCategory = ['clinical', 'public_relations', 'managing_director'].includes(user.category)
    ? user.category
    : 'clinical';

  const role = validCategory === 'managing_director'
    ? 'Managing Director'
    : validCategory === 'public_relations'
      ? 'Public Relations Officer'
      : 'Clinical Staff';

  const isDutyManager = validCategory === 'managing_director';
  const displayName = (user.name || '').trim() || (user.username ? `@${user.username}` : 'Hospital Staff');

  try {
    // 1. Link orphan contact if one exists with this exact phone
    await pool.query(
      `update public.staff_alert_contacts
       set user_id = $1
       where phone_e164 = $2 and user_id is null`,
      [userId, e164Phone]
    ).catch(() => {});

    // 2. Insert or update contact linked to this user
    const result = await pool.query(
      `insert into public.staff_alert_contacts
        (user_id, name, phone_e164, role, target_category, is_duty_manager, alert_enabled, min_severity, sms_enabled, email_enabled)
       values
        ($1, $2, $3, $4, $5, $6, true, 'normal', true, true)
       on conflict (user_id) do update
         set name = excluded.name,
             phone_e164 = excluded.phone_e164,
             role = excluded.role,
             target_category = excluded.target_category,
             is_duty_manager = excluded.is_duty_manager,
             alert_enabled = true,
             updated_at = now()
       returning id, name, phone_e164, target_category, is_duty_manager`,
      [userId, displayName, e164Phone, role, validCategory, isDutyManager]
    );

    return result.rows[0] || null;
  } catch (err) {
    console.warn(`[CONTACT SYNC ERROR] Could not sync user ${userId}:`, err.message);
    return null;
  }
}

