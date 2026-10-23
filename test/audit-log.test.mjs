import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { recordAuditEvent } from '../backend/audit-log.mjs';

const migration = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'backend', 'neon', 'audit-log-migration.sql'),
  'utf8'
);
const authBackend = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'backend', 'neon-auth.mjs'),
  'utf8'
);
const neonBackend = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'backend', 'neon-backend.mjs'),
  'utf8'
);

test('audit events use parameterized inserts and preserve safe event metadata', async () => {
  let statement;
  let values;
  await recordAuditEvent({
    async query(sql, parameters) {
      statement = sql;
      values = parameters;
    }
  }, {
    actorId: 'admin-1',
    action: 'feedback.deleted',
    summary: 'Deleted a feedback submission.',
    targetType: 'feedback',
    targetId: 'response-1',
    metadata: { source: 'dashboard' }
  });

  assert.match(statement, /insert into public\.feedback_audit_events/);
  assert.match(statement, /values \(\$1, \$2, \$3, \$4, \$5, \$6::jsonb\)/);
  assert.deepEqual(values, [
    'admin-1',
    'feedback.deleted',
    'Deleted a feedback submission.',
    'feedback',
    'response-1',
    '{"source":"dashboard"}'
  ]);
});

test('audit migration creates indexed append-only event storage', () => {
  assert.match(migration, /create table if not exists public\.feedback_audit_events/i);
  assert.match(migration, /created_at timestamptz not null default now\(\)/i);
  assert.match(migration, /feedback_audit_events_created_at_idx/i);
  assert.match(migration, /metadata jsonb not null default '\{\}'::jsonb/i);
});

test('successful logins and feedback mutations are written by the server', () => {
  assert.match(authBackend, /session:\s*\{\s*create:\s*\{\s*after:/);
  assert.match(authBackend, /action:\s*'auth\.login'/);
  assert.match(neonBackend, /action:\s*'feedback\.submitted'/);
  assert.match(neonBackend, /action:\s*'feedback\.deleted'/);
  assert.match(neonBackend, /action:\s*'feedback\.cleared'/);
  assert.match(neonBackend, /if \(pathname === '\/api\/admin\/audit'\)/);
  assert.match(neonBackend, /if \(!await requireApprovedAccount\(request, response, pool, getAuthSession\)\) return true;/);
});
