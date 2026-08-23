import process from 'node:process';

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_SECRET',
  'KICK_CLIENT_ID',
  'KICK_CLIENT_SECRET',
  'KICK_REDIRECT_URI',
  'ADMIN_KICK_USER_IDS',
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing production variables: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.COOKIE_SECURE === 'false') {
  console.error('COOKIE_SECURE must not be false in production.');
  process.exit(1);
}

const baseUrl = new URL(process.env.PUBLIC_BASE_URL || 'https://placeholder.invalid');
if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== 'localhost') {
  console.error('PUBLIC_BASE_URL must use HTTPS in production.');
  process.exit(1);
}

const redirect = new URL(process.env.KICK_REDIRECT_URI);
if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost') {
  console.error('KICK_REDIRECT_URI must use HTTPS in production.');
  process.exit(1);
}

if (process.env.WATCH_INGEST_SECRET && process.env.WATCH_INGEST_SECRET.length < 32) {
  console.error('WATCH_INGEST_SECRET must be at least 32 characters.');
  process.exit(1);
}

console.log('Production environment checks passed.');
