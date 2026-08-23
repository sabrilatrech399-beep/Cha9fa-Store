import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { createClient } from '@supabase/supabase-js';

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'KICK_CLIENT_ID',
  'KICK_CLIENT_SECRET',
  'KICK_REDIRECT_URI',
  'SESSION_SECRET',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = 'cha9fa_session';
const OAUTH_COOKIE = 'cha9fa_kick_oauth';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_TTL_SECONDS = 600;
const ADMIN_IDS = new Set((process.env.ADMIN_KICK_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '20kb' }));

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url');
}

function signedValue(payload) {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${hmac(encoded)}`;
}

function verifySignedValue(value) {
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = hmac(encoded);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return null; }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
  }));
}

function setCookie(res, name, value, maxAge) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

async function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = sha256(token);
  const { data, error } = await supabase
    .from('auth_sessions')
    .select('id, store_user_id, expires_at, store_users(id, kick_user_id, kick_username, points)')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error || !data?.store_users) return null;
  return { session: data, user: data.store_users };
}

async function requireSession(req, res, next) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  req.auth = session;
  next();
}

async function requireAdmin(req, res, next) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  if (!ADMIN_IDS.has(String(session.user.kick_user_id))) return res.status(403).json({ error: 'ADMIN_REQUIRED' });
  req.auth = session;
  next();
}

async function kickTokenExchange(code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.KICK_CLIENT_ID,
    client_secret: process.env.KICK_CLIENT_SECRET,
    redirect_uri: process.env.KICK_REDIRECT_URI,
    code_verifier: verifier,
  });
  const response = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`KICK_TOKEN_EXCHANGE_${response.status}`);
  return response.json();
}

async function kickUser(accessToken) {
  const response = await fetch('https://api.kick.com/public/v1/users', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`KICK_USER_LOOKUP_${response.status}`);
  const body = await response.json();
  const candidate = Array.isArray(body?.data) ? body.data[0] : body?.data || body?.user || body;
  const id = candidate?.user_id ?? candidate?.id;
  const username = candidate?.username ?? candidate?.name;
  if (!id || !username) throw new Error('KICK_USER_RESPONSE_INVALID');
  return { id: String(id), username: String(username) };
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/auth/kick', (req, res) => {
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const oauthPayload = signedValue({ state, verifier, exp: Date.now() + OAUTH_TTL_SECONDS * 1000 });
  setCookie(res, OAUTH_COOKIE, oauthPayload, OAUTH_TTL_SECONDS);

  const url = new URL('https://id.kick.com/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.KICK_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.KICK_REDIRECT_URI);
  url.searchParams.set('scope', 'user:read');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
});

app.get('/auth/kick/callback', async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const oauth = verifySignedValue(cookies[OAUTH_COOKIE]);
    clearCookie(res, OAUTH_COOKIE);
    if (!oauth || oauth.exp < Date.now() || !req.query.state || req.query.state !== oauth.state) {
      return res.status(400).send('Invalid OAuth state. Please try again.');
    }
    if (req.query.error) return res.status(400).send('Kick authorization was not completed.');

    const tokens = await kickTokenExchange(String(req.query.code || ''), oauth.verifier);
    const kickUserData = await kickUser(tokens.access_token);

    const { data: user, error: userError } = await supabase
      .from('store_users')
      .upsert({ kick_user_id: kickUserData.id, kick_username: kickUserData.username }, { onConflict: 'kick_user_id' })
      .select('id, kick_user_id, kick_username, points')
      .single();
    if (userError) throw userError;

    const sessionToken = randomToken(48);
    const { error: sessionError } = await supabase.from('auth_sessions').insert({
      store_user_id: user.id,
      token_hash: sha256(sessionToken),
      expires_at: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    });
    if (sessionError) throw sessionError;

    setCookie(res, SESSION_COOKIE, sessionToken, SESSION_TTL_SECONDS);
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(502).send('تعذر تسجيل الدخول بواسطة Kick. حاول مرة أخرى.');
  }
});

app.post('/auth/logout', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) await supabase.from('auth_sessions').delete().eq('token_hash', sha256(token));
  clearCookie(res, SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const session = await getSession(req);
  if (!session) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: session.user });
});

app.get('/api/products', async (_req, res) => {
  const { data, error } = await supabase.from('products').select('id,name,diamonds,price_points,image_url').eq('active', true).order('diamonds');
  if (error) return res.status(500).json({ error: 'PRODUCTS_UNAVAILABLE' });
  res.json({ products: data });
});

app.post('/api/orders', requireSession, async (req, res) => {
  const { productId, playerName, country, gameId } = req.body || {};
  if (typeof productId !== 'string' || typeof playerName !== 'string' || typeof country !== 'string' || typeof gameId !== 'string') {
    return res.status(400).json({ error: 'INVALID_REQUEST' });
  }

  const { data, error } = await supabase.rpc('spend_points_for_order', {
    p_store_user_id: req.auth.user.id,
    p_product_id: productId,
    p_player_name: playerName.trim(),
    p_country: country.trim(),
    p_game_id: gameId.trim(),
  });

  if (error) {
    const message = String(error.message || '');
    if (message.includes('INSUFFICIENT_POINTS')) return res.status(409).json({ error: 'INSUFFICIENT_POINTS' });
    if (message.includes('PRODUCT_NOT_FOUND')) return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
    if (message.includes('INVALID_')) return res.status(400).json({ error: message.match(/INVALID_[A-Z_]+/)?.[0] || 'INVALID_REQUEST' });
    console.error(error);
    return res.status(500).json({ error: 'ORDER_FAILED' });
  }

  const refreshed = await getSession(req);
  res.status(201).json({ order: data, points: refreshed?.user?.points ?? null });
});

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  const [{ data: users, error: usersError }, { data: orders, error: ordersError }] = await Promise.all([
    supabase.from('store_users').select('id,kick_user_id,kick_username,points,created_at,updated_at').order('points', { ascending: false }),
    supabase.from('orders').select('id,store_user_id,product_id,diamonds,price_points,player_name,country,game_id,status,points_before,points_after,created_at').order('created_at', { ascending: false }).limit(500),
  ]);
  if (usersError || ordersError) return res.status(500).json({ error: 'ADMIN_DATA_UNAVAILABLE' });
  res.json({ users, orders });
});

app.listen(PORT, () => console.log(`Cha9fa Store server listening on ${PORT}`));
