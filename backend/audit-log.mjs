export async function recordAuditEvent(database, {
  actorId = null,
  action,
  summary,
  targetType = null,
  targetId = null,
  metadata = {}
}) {
  if (typeof action !== 'string' || !action || typeof summary !== 'string' || !summary) {
    throw new TypeError('Audit events require an action and summary.');
  }

  await database.query(
    `insert into public.feedback_audit_events
      (actor_user_id, action, summary, target_type, target_id, metadata)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [actorId, action, summary, targetType, targetId, JSON.stringify(metadata)]
  );
}
