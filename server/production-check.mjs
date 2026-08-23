import assert from 'node:assert/strict';

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_SECRET',
  'KICK_CLIENT_ID',
  'KICK_CLIENT_SECRET',
  'KICK_REDIRECT_URI',
];

for (const name of required) {
  assert(process.env[name], `Missing ${name}`);
}

assert(process.env.SESSION_SECRET.length >= 32, 'SESSION_SECRET must be at least 32 characters');
assert(process.env.SUPABASE_SERVICE_ROLE_KEY.length >= 20, 'SUPABASE_SERVICE_ROLE_KEY looks too short');
assert(process.env.KICK_CLIENT_SECRET.length >= 16, 'KICK_CLIENT_SECRET looks too short');
assert(/^https:\/\//.test(process.env.PUBLIC_BASE_URL || ''), 'PUBLIC_BASE_URL must use HTTPS');
assert(/^https:\/\//.test(process.env.KICK_REDIRECT_URI || ''), 'KICK_REDIRECT_URI must use HTTPS');
assert(process.env.COOKIE_SECURE !== 'false', 'COOKIE_SECURE must remain enabled in production');

if (process.env.WATCH_POINTS_PER_MINUTE !== undefined) {
  const rate = Number(process.env.WATCH_POINTS_PER_MINUTE);
  assert(Number.isInteger(rate) && rate >= 0 && rate <= 100, 'WATCH_POINTS_PER_MINUTE must be an integer from 0 to 100');
}

if (process.env.WATCH_INGEST_SECRET !== undefined) {
  assert(process.env.WATCH_INGEST_SECRET.length >= 32, 'WATCH_INGEST_SECRET must be at least 32 characters');
}

console.log('Production environment validation passed.');
