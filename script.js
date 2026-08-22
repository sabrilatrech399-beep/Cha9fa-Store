const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// =====================================================
// ENV / SETTINGS
// =====================================================

const CLIENT_ID = String(process.env.KICK_CLIENT_ID || "").trim();
const CLIENT_SECRET = String(process.env.KICK_CLIENT_SECRET || "").trim();

const PUBLIC_BASE_URL = String(
  process.env.PUBLIC_BASE_URL || "https://kick-bot-xhfl.onrender.com"
).replace(/\/$/, "");

const REDIRECT_URI = String(
  process.env.KICK_REDIRECT_URI ||
  process.env.KICK_BOT_REDIRECT_URI ||
  `${PUBLIC_BASE_URL}/auth/kick/callback`
).trim();

const WEBHOOK_URL = String(
  process.env.KICK_WEBHOOK_URL ||
  `${PUBLIC_BASE_URL}/webhook/kick`
).trim();

const DEBUG_KEY = String(process.env.DEBUG_KEY || "").trim();

const BOT_SCOPES = String(
  process.env.KICK_BOT_SCOPES ||
  "user:read channel:read chat:write events:subscribe"
).trim().replace(/\s+/g, " ");

// اسم قناة Kick التي سيعرضها المتجر.
const KICK_CHANNEL_SLUG = String(
  process.env.KICK_CHANNEL_SLUG || ""
).trim().replace(/^@/, "").toLowerCase();

// رابط مشروع Supabase.
const SUPABASE_URL =
  process.env.SUPABASE_URL || "";

// استخدم anon/publishable key للتحقق من جلسة المستخدم عبر Auth API.
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";

// النقاط التي يحصل عليها المشاهد من نشاط الشات.
const POINTS_PER_MESSAGE = Number(
  process.env.POINTS_PER_MESSAGE || 5
);

// لا يحصل المستخدم على نقاط الرسائل أكثر من مرة خلال هذه المدة.
const MESSAGE_COOLDOWN = Number(
  process.env.MESSAGE_COOLDOWN_MS || 60 * 1000
);

// نقاط المتابعة.
const FOLLOW_POINTS = Number(
  process.env.FOLLOW_POINTS || 100
);

// نقاط الاشتراك.
const SUB_POINTS = Number(
  process.env.SUB_POINTS || 250
);

// تكلفة مشاهدة دقيقة واحدة من البث.
const WATCH_COST_PER_MINUTE = Number(
  process.env.WATCH_COST_PER_MINUTE || 10
);

// يجب أن يرسل المتصفح heartbeat كل هذه المدة تقريباً.
const WATCH_HEARTBEAT_MS = Number(
  process.env.WATCH_HEARTBEAT_MS || 60 * 1000
);

// السماح بهامش بسيط لتأخر الشبكة.
const WATCH_HEARTBEAT_TOLERANCE_MS = Number(
  process.env.WATCH_HEARTBEAT_TOLERANCE_MS || 15 * 1000
);

// مدة جلسة المشاهدة القصوى بدون heartbeat جديد.
const WATCH_SESSION_TIMEOUT_MS = Math.max(
  WATCH_HEARTBEAT_MS + WATCH_HEARTBEAT_TOLERANCE_MS,
  Number(
    process.env.WATCH_SESSION_TIMEOUT_MS ||
    3 * 60 * 1000
  )
);

// منع إعادة إرسال webhook قديم حتى لو كانت التوقيع صحيحة.
const WEBHOOK_MAX_AGE_MS = Math.max(
  30_000,
  Number(
    process.env.WEBHOOK_MAX_AGE_MS ||
    5 * 60 * 1000
  )
);

// =====================================================
// DATA
// =====================================================

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
const EVENTS_FILE = path.join(DATA_DIR, "processed-events.json");
const WATCH_FILE = path.join(DATA_DIR, "watch-sessions.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error("Database read error:", file, error);
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(
      tempFile,
      JSON.stringify(data, null, 2),
      "utf8"
    );
    fs.renameSync(tempFile, file);
  } catch (error) {
    console.error("Database save error:", file, error);
  }
}

let users = loadJSON(USERS_FILE, {});

let tokens = loadJSON(TOKENS_FILE, {
  access_token: null,
  refresh_token: null,
  expires_at: 0
});

let processedEvents = loadJSON(EVENTS_FILE, {});
let watchSessions = loadJSON(WATCH_FILE, {});

// =====================================================
// OAUTH STATE
// =====================================================

let oauthState = null;
let codeVerifier = null;

// =====================================================
// EXPRESS
// =====================================================

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    }
  })
);

// =====================================================
// HELPERS
// =====================================================

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

function cleanupProcessedEvents() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const [eventId, createdAt] of Object.entries(processedEvents)) {
    if (Number(createdAt) < cutoff) {
      delete processedEvents[eventId];
    }
  }

  saveJSON(EVENTS_FILE, processedEvents);
}

function hasProcessedEvent(eventId) {
  if (!eventId) return false;
  return Boolean(processedEvents[eventId]);
}

function markEventProcessed(eventId) {
  if (!eventId) return;
  processedEvents[eventId] = Date.now();
  saveJSON(EVENTS_FILE, processedEvents);
}

function getUser(userId, username) {
  const id = String(userId);

  if (!users[id]) {
    users[id] = {
      id,
      username: username || "Unknown",
      points: 0,
      messages: 0,
      lastPointTime: 0,
      followRewarded: false,
      subscriptionRewarded: false,
      supabaseUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  if (username) users[id].username = username;
  users[id].updatedAt = new Date().toISOString();

  return users[id];
}

function saveUsers() {
  saveJSON(USERS_FILE, users);
}

function addPoints(userId, username, amount, reason = "manual") {
  const user = getUser(userId, username);
  const value = safeNumber(amount);

  if (value <= 0) return user;

  user.points = Math.max(
    0,
    safeNumber(user.points) + value
  );

  user.updatedAt = new Date().toISOString();
  saveUsers();

  console.log(
    `[POINTS] ${user.username} ${value > 0 ? "+" : ""}${value} (${reason}) => ${user.points}`
  );

  return user;
}

function spendPoints(userId, amount, reason = "store") {
  const user = getUser(userId);
  const cost = safeNumber(amount);

  if (cost <= 0) {
    return { ok: true, user };
  }

  if (safeNumber(user.points) < cost) {
    return {
      ok: false,
      user,
      error: "INSUFFICIENT_POINTS"
    };
  }

  user.points -= cost;
  user.updatedAt = new Date().toISOString();
  saveUsers();

  console.log(
    `[SPEND] ${user.username} -${cost} (${reason}) => ${user.points}`
  );

  return { ok: true, user };
}

function getRank(userId) {
  const list = Object.values(users).sort(
    (a, b) => safeNumber(b.points) - safeNumber(a.points)
  );

  const index = list.findIndex(
    user => String(user.id) === String(userId)
  );

  return index === -1 ? null : index + 1;
}

function getTop(limit = 5) {
  return Object.values(users)
    .sort(
      (a, b) => safeNumber(b.points) - safeNumber(a.points)
    )
    .slice(0, limit);
}

function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: String(user.id),
    username: user.username || "Unknown",
    points: safeNumber(user.points),
    messages: safeNumber(user.messages),
    rank: getRank(user.id),
    followRewarded: Boolean(user.followRewarded),
    subscriptionRewarded: Boolean(user.subscriptionRewarded),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =====================================================
// SUPABASE AUTH
// =====================================================

async function getSupabaseUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_ANON_KEY is missing"
    );
  }

  if (!accessToken) return null;

  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

async function requireSupabaseUser(req, res) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    res.status(401).json({
      ok: false,
      error: "KICK_LOGIN_REQUIRED"
    });
    return null;
  }

  const accessToken = header.slice("Bearer ".length).trim();

  try {
    const user = await getSupabaseUser(accessToken);

    if (!user) {
      res.status(401).json({
        ok: false,
        error: "INVALID_SUPABASE_SESSION"
      });
      return null;
    }

    return user;
  } catch (error) {
    console.error("Supabase auth error:", error);

    res.status(500).json({
      ok: false,
      error: "AUTH_SERVICE_ERROR"
    });

    return null;
  }
}

function getKickUserFromSupabaseUser(supabaseUser) {
  if (!supabaseUser) return null;

  const metadata = supabaseUser.user_metadata || {};
  const identities = Array.isArray(supabaseUser.identities)
    ? supabaseUser.identities
    : [];

  const kickIdentity = identities.find(
    identity =>
      String(identity.provider || "").toLowerCase() === "kick" ||
      String(identity.provider || "").toLowerCase() === "custom:kick"
  );

  const identityData = kickIdentity?.identity_data || {};

  const kickId =
    identityData.user_id ||
    identityData.sub ||
    metadata.user_id ||
    metadata.sub ||
    null;

  const username =
    identityData.username ||
    identityData.preferred_username ||
    metadata.username ||
    metadata.preferred_username ||
    null;

  return kickId
    ? {
        id: String(kickId),
        username: username || "Kick User"
      }
    : null;
}

// =====================================================
// KICK BOT OAUTH
// =====================================================

app.get("/auth/kick", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send(
      "KICK_CLIENT_ID or KICK_CLIENT_SECRET missing"
    );
  }

  codeVerifier = crypto.randomBytes(64).toString("hex");

  const challenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  oauthState = crypto.randomBytes(32).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: BOT_SCOPES,
    state: oauthState,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  res.redirect(
    `https://id.kick.com/oauth/authorize?${params.toString()}`
  );
});

app.get("/auth/kick/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(
      `Kick OAuth Error: ${String(error)}`
    );
  }

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  if (!state || state !== oauthState) {
    return res.status(400).send("Invalid OAuth state");
  }

  if (!codeVerifier) {
    return res.status(400).send("Missing PKCE verifier");
  }

  try {
    const response = await fetch(
      "https://id.kick.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: String(code),
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OAuth error:", data);
      return res.status(400).send(
        `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`
      );
    }

    tokens.access_token = data.access_token;
    tokens.refresh_token = data.refresh_token || null;
    tokens.expires_at =
      Date.now() + safeNumber(data.expires_in, 3600) * 1000;

    saveJSON(TOKENS_FILE, tokens);

    oauthState = null;
    codeVerifier = null;

    console.log("KICK BOT LOGIN SUCCESS");

    const subscriptions = await subscribeToKickEvents();

    res.send(`
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head><meta charset="UTF-8"><title>Cha9fa Store</title></head>
        <body style="font-family:Arial;text-align:center;padding:50px">
          <h1>تم ربط Kick بنجاح ✅</h1>
          <p>البوت متصل ويمكنه استقبال أحداث Kick.</p>
          <pre style="text-align:left;max-width:900px;margin:30px auto">${escapeHtml(
            JSON.stringify(subscriptions, null, 2)
          )}</pre>
          <a href="/">العودة</a>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).send("OAuth error");
  }
});

// =====================================================
// KICK TOKEN
// =====================================================

async function refreshToken() {
  if (!tokens.refresh_token) {
    throw new Error("No refresh token");
  }

  const response = await fetch(
    "https://id.kick.com/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Refresh token error:", data);
    throw new Error("Could not refresh token");
  }

  tokens.access_token = data.access_token;

  if (data.refresh_token) {
    tokens.refresh_token = data.refresh_token;
  }

  tokens.expires_at =
    Date.now() + safeNumber(data.expires_in, 3600) * 1000;

  saveJSON(TOKENS_FILE, tokens);

  return tokens.access_token;
}

async function getAccessToken() {
  if (!tokens.access_token) {
    throw new Error("Bot is not authenticated");
  }

  if (
    Date.now() >
    safeNumber(tokens.expires_at) - 120000
  ) {
    return refreshToken();
  }

  return tokens.access_token;
}

async function kickAPI(endpoint, options = {}) {
  let accessToken = await getAccessToken();

  let response = await fetch(
    `https://api.kick.com${endpoint}`,
    {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (response.status === 401 && tokens.refresh_token) {
    accessToken = await refreshToken();

    response = await fetch(
      `https://api.kick.com${endpoint}`,
      {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );
  }

  return response;
}

// =====================================================
// CHANNEL
// =====================================================

async function getBroadcasterId() {
  const response = await kickAPI(
    "/public/v1/channels"
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Channel API error:", data);
    throw new Error("Unable to get broadcaster");
  }

  const channels = data.data || [];

  if (!channels.length) {
    throw new Error("No channel found");
  }

  const configured = KICK_CHANNEL_SLUG
    ? channels.find(
        channel =>
          String(channel.slug || "").toLowerCase() ===
          KICK_CHANNEL_SLUG.toLowerCase()
      )
    : channels[0];

  const channel = configured || channels[0];

  return (
    channel.broadcaster_user_id ||
    channel.user_id ||
    channel.id
  );
}

async function getChannelInfo() {
  const response = await kickAPI(
    "/public/v1/channels"
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Unable to get channel info");
  }

  const channels = data.data || [];

  const channel = KICK_CHANNEL_SLUG
    ? channels.find(
        item =>
          String(item.slug || "").toLowerCase() ===
          KICK_CHANNEL_SLUG.toLowerCase()
      )
    : channels[0];

  return channel || null;
}

async function isChannelLive() {
  try {
    const channel = await getChannelInfo();
    return Boolean(channel?.stream?.is_live);
  } catch (error) {
    console.error("Live status error:", error);
    return false;
  }
}

// =====================================================
// CHAT
// =====================================================

async function sendMessage(message) {
  try {
    const broadcasterId = await getBroadcasterId();

    const response = await kickAPI(
      "/public/v1/chat",
      {
        method: "POST",
        body: JSON.stringify({
          broadcaster_user_id: Number(broadcasterId),
          content: String(message),
          type: "user"
        })
      }
    );

    const text = await response.text();

    console.log(
      "CHAT SEND:",
      response.status,
      text
    );

    return response.ok;
  } catch (error) {
    console.error("Send message error:", error);
    return false;
  }
}

// =====================================================
// WEBHOOK SUBSCRIPTIONS
// =====================================================

const KICK_EVENTS = [
  "chat.message.sent",
  "channel.followed",
  "channel.subscription.new",
  "channel.subscription.renewal",
  "channel.subscription.gifts",
  "livestream.status.updated"
];

async function subscribeToKickEvents() {
  const broadcasterId = await getBroadcasterId();
  const results = [];

  for (const name of KICK_EVENTS) {
    try {
      const response = await kickAPI(
        "/public/v1/events/subscriptions",
        {
          method: "POST",
          body: JSON.stringify({
            broadcaster_user_id: Number(broadcasterId),
            events: [
              {
                name,
                version: 1
              }
            ],
            method: "webhook",
            callback_url: WEBHOOK_URL
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      results.push({
        event: name,
        ok: response.ok,
        status: response.status,
        data
      });
    } catch (error) {
      results.push({
        event: name,
        ok: false,
        error: error.message
      });
    }
  }

  return results;
}

// =====================================================
// CHAT COMMANDS
// =====================================================

async function handleChatCommand(userId, username, message) {
  const command = String(message || "")
    .trim()
    .toLowerCase();

  const user = getUser(userId, username);

  if (command === "!points" || command === "!نقاطي") {
    await sendMessage(
      `@${username} لديك ${safeNumber(user.points).toLocaleString()} نقطة.`
    );
    return;
  }

  if (command === "!rank") {
    const rank = getRank(user.id);
    await sendMessage(
      `@${username} ترتيبك الحالي: #${rank || "-"}`
    );
    return;
  }

  if (command === "!top") {
    const top = getTop(5);
    const text = top
      .map(
        (item, index) =>
          `${index + 1}. ${item.username}: ${safeNumber(item.points)}`
      )
      .join(" | ");

    await sendMessage(`أفضل 5: ${text}`);
    return;
  }

  if (command === "!stats") {
    await sendMessage(
      `@${username} نقاطك: ${safeNumber(user.points).toLocaleString()} | رسائلك: ${safeNumber(user.messages)}`
    );
    return;
  }

  if (command === "!hello") {
    await sendMessage(
      `@${username} أهلاً بك. البوت يعمل بنجاح.`
    );
    return;
  }

  if (command === "!ping") {
    await sendMessage(`@${username} Pong! البوت يعمل.`);
    return;
  }

  if (command === "!help") {
    await sendMessage(
      "الأوامر: !points | !نقاطي | !rank | !top | !stats | !hello | !ping"
    );
  }
}

// =====================================================
// WEBHOOK SIGNATURE
// =====================================================

let publicKey = null;

async function getPublicKey() {
  if (publicKey) return publicKey;

  const response = await fetch(
    "https://api.kick.com/public/v1/public-key"
  );

  const data = await response.json();

  publicKey =
    data.data?.public_key ||
    data.public_key ||
    null;

  return publicKey;
}

async function verifyWebhook(req) {
  try {
    const messageId =
      req.headers["kick-event-message-id"];

    const timestamp =
      req.headers["kick-event-message-timestamp"];

    const signature =
      req.headers["kick-event-signature"];

    if (
      !messageId ||
      !timestamp ||
      !signature ||
      !req.rawBody
    ) {
      return false;
    }

    const timestampMs = Date.parse(String(timestamp));
    if (Number.isFinite(timestampMs)) {
      const age = Math.abs(Date.now() - timestampMs);
      if (age > WEBHOOK_MAX_AGE_MS) {
        console.warn("Rejected stale Kick webhook:", age);
        return false;
      }
    }

    const key = await getPublicKey();

    if (!key) return false;

    const payload =
      `${messageId}.${timestamp}.${req.rawBody.toString()}`;

    const verifier = crypto.createVerify(
      "RSA-SHA256"
    );

    verifier.update(payload);
    verifier.end();

    return verifier.verify(
      key,
      Buffer.from(signature, "base64")
    );
  } catch (error) {
    console.error("Webhook verification error:", error);
    return false;
  }
}

// =====================================================
// WEBHOOK EVENT HANDLERS
// =====================================================

app.post("/webhook/kick", async (req, res) => {
  const valid = await verifyWebhook(req);

  if (!valid) {
    console.error("INVALID KICK WEBHOOK");
    return res.status(401).send("Invalid signature");
  }

  const eventType =
    req.headers["kick-event-type"];

  const eventId =
    req.headers["kick-event-message-id"];

  if (hasProcessedEvent(eventId)) {
    return res.sendStatus(200);
  }

  markEventProcessed(eventId);

  console.log("KICK EVENT:", eventType);

  // ---------------------------------------------------
  // CHAT MESSAGE
  // ---------------------------------------------------
  if (eventType === "chat.message.sent") {
    const sender = req.body.sender || {};

    const userId =
      sender.user_id || sender.id;

    const username =
      sender.username ||
      sender.slug ||
      "Viewer";

    const message =
      req.body.content || "";

    if (!userId) return res.sendStatus(200);

    const user = getUser(userId, username);
    user.messages = safeNumber(user.messages) + 1;

    const now = Date.now();
    const lastPointTime = safeNumber(
      user.lastPointTime
    );

    if (
      now - lastPointTime >=
      MESSAGE_COOLDOWN
    ) {
      user.lastPointTime = now;
      addPoints(
        userId,
        username,
        POINTS_PER_MESSAGE,
        "chat-message"
      );
    } else {
      saveUsers();
    }

    await handleChatCommand(
      userId,
      username,
      message
    );

    return res.sendStatus(200);
  }

  // ---------------------------------------------------
  // FOLLOW
  // ---------------------------------------------------
  if (eventType === "channel.followed") {
    const follower = req.body.user || req.body.follower || {};

    const userId =
      follower.user_id ||
      follower.id;

    const username =
      follower.username ||
      follower.slug ||
      "Viewer";

    if (userId) {
      const user = getUser(userId, username);

      if (!user.followRewarded) {
        user.followRewarded = true;
        saveUsers();

        addPoints(
          userId,
          username,
          FOLLOW_POINTS,
          "follow"
        );

        await sendMessage(
          `@${username} شكراً على المتابعة. حصلت على ${FOLLOW_POINTS} نقطة.`
        );
      }
    }

    return res.sendStatus(200);
  }

  // ---------------------------------------------------
  // SUBSCRIPTION
  // ---------------------------------------------------
  if (
    eventType === "channel.subscription.new" ||
    eventType === "channel.subscription.renewal" ||
    eventType === "channel.subscription.gifts"
  ) {
    const subscriber =
      req.body.subscriber ||
      req.body.user ||
      {};

    const userId =
      subscriber.user_id ||
      subscriber.id;

    const username =
      subscriber.username ||
      subscriber.slug ||
      "Viewer";

    if (userId) {
      const user = getUser(userId, username);

      if (
        eventType === "channel.subscription.new" &&
        !user.subscriptionRewarded
      ) {
        user.subscriptionRewarded = true;
        saveUsers();

        addPoints(
          userId,
          username,
          SUB_POINTS,
          "subscription"
        );

        await sendMessage(
          `@${username} شكراً على الاشتراك. حصلت على ${SUB_POINTS} نقطة.`
        );
      }
    }

    return res.sendStatus(200);
  }

  return res.sendStatus(200);
});

// =====================================================
// STORE - KICK LOGIN / LINK
// =====================================================

// ربط حساب Supabase بحساب Kick الحقيقي.
// provider_token يأتي من session.provider_token بعد تسجيل الدخول عبر Kick.
app.post("/api/store/link-kick", async (req, res) => {
  const supabaseUser = await requireSupabaseUser(
    req,
    res
  );

  if (!supabaseUser) return;

  const providerToken =
    req.body?.provider_token;

  if (!providerToken) {
    return res.status(400).json({
      ok: false,
      error: "KICK_PROVIDER_TOKEN_REQUIRED"
    });
  }

  try {
    const response = await fetch(
      "https://api.kick.com/public/v1/users",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${providerToken}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Kick user lookup error:", data);

      return res.status(401).json({
        ok: false,
        error: "INVALID_KICK_PROVIDER_TOKEN"
      });
    }

    const kickUser =
      Array.isArray(data.data)
        ? data.data[0]
        : data.data;

    const kickId =
      kickUser?.user_id ||
      kickUser?.id;

    const username =
      kickUser?.username ||
      kickUser?.slug ||
      "Kick User";

    if (!kickId) {
      return res.status(400).json({
        ok: false,
        error: "KICK_USER_NOT_FOUND"
      });
    }

    const user = getUser(kickId, username);

    user.supabaseUserId =
      supabaseUser.id;

    user.updatedAt = new Date().toISOString();
    saveUsers();

    return res.json({
      ok: true,
      kickUser: {
        id: String(kickId),
        username
      },
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error("Kick linking error:", error);

    return res.status(500).json({
      ok: false,
      error: "KICK_LINK_ERROR"
    });
  }
});

function findUserBySupabaseId(supabaseUserId) {
  return Object.values(users).find(
    user =>
      String(user.supabaseUserId || "") ===
      String(supabaseUserId || "")
  );
}

async function requireStoreUser(req, res) {
  const supabaseUser = await requireSupabaseUser(
    req,
    res
  );

  if (!supabaseUser) return null;

  let user = findUserBySupabaseId(
    supabaseUser.id
  );

  // إذا كانت الهوية موجودة داخل Supabase، نحاول ربطها بدون provider token.
  if (!user) {
    const kickUser = getKickUserFromSupabaseUser(
      supabaseUser
    );

    if (kickUser) {
      user = getUser(
        kickUser.id,
        kickUser.username
      );
      user.supabaseUserId = supabaseUser.id;
      saveUsers();
    }
  }

  if (!user) {
    res.status(403).json({
      ok: false,
      error: "KICK_LINK_REQUIRED",
      message:
        "يجب تسجيل الدخول بحساب Kick وربطه بالمتجر أولاً."
    });
    return null;
  }

  return {
    supabaseUser,
    user
  };
}

// =====================================================
// STORE - CURRENT USER
// =====================================================

app.get("/api/store/me", async (req, res) => {
  const storeUser = await requireStoreUser(
    req,
    res
  );

  if (!storeUser) return;

  const { user } = storeUser;

  res.json({
    ok: true,
    authenticated: true,
    user: sanitizeUser(user),
    watch: {
      costPerMinute: WATCH_COST_PER_MINUTE,
      heartbeatMs: WATCH_HEARTBEAT_MS,
      channel: KICK_CHANNEL_SLUG,
      followRequired: true,
      followApiAvailable: false
    }
  });
});

// =====================================================
// STORE - FOLLOW STATUS
// =====================================================

// لا يوجد حالياً endpoint رسمي في Kick API يسمح للتطبيق بفحص/تنفيذ follow نيابة عن المستخدم.
// لذلك نعتمد على webhook channel.followed لتسجيل المتابعة بعد أن تتم من Kick.
app.get("/api/store/follow-status", async (req, res) => {
  const storeUser = await requireStoreUser(
    req,
    res
  );

  if (!storeUser) return;

  const { user } = storeUser;

  res.json({
    ok: true,
    followed: Boolean(user.followRewarded),
    followRequired: true,
    followUrl: KICK_CHANNEL_SLUG
      ? `https://kick.com/${encodeURIComponent(KICK_CHANNEL_SLUG)}`
      : "https://kick.com/"
  });
});

// =====================================================
// STORE - WATCH SESSION
// =====================================================

function getWatchSession(sessionId) {
  return watchSessions[String(sessionId)] || null;
}

function saveWatchSessions() {
  saveJSON(WATCH_FILE, watchSessions);
}

function cleanupWatchSessions() {
  const cutoff = Date.now() - 30 * 60 * 1000;

  for (const [id, session] of Object.entries(
    watchSessions
  )) {
    if (
      safeNumber(session.lastHeartbeatAt) < cutoff
    ) {
      delete watchSessions[id];
    }
  }

  saveWatchSessions();
}

// بدء المشاهدة.
app.post("/api/store/watch/start", async (req, res) => {
  const storeUser = await requireStoreUser(
    req,
    res
  );

  if (!storeUser) return;

  const { user } = storeUser;

  if (!KICK_CHANNEL_SLUG) {
    return res.status(500).json({
      ok: false,
      error: "KICK_CHANNEL_SLUG_MISSING"
    });
  }

  const live = await isChannelLive();

  if (!live) {
    return res.status(409).json({
      ok: false,
      error: "STREAM_OFFLINE",
      message: "البث غير مباشر حالياً."
    });
  }

  const sessionId = createId("watch");
  const now = Date.now();

  watchSessions[sessionId] = {
    id: sessionId,
    kickUserId: String(user.id),
    supabaseUserId: String(
      storeUser.supabaseUser.id
    ),
    startedAt: now,
    lastHeartbeatAt: now,
    minutesCharged: 0,
    active: true
  };

  saveWatchSessions();

  res.json({
    ok: true,
    sessionId,
    channel: KICK_CHANNEL_SLUG,
    costPerMinute: WATCH_COST_PER_MINUTE,
    heartbeatMs: WATCH_HEARTBEAT_MS,
    balance: safeNumber(user.points)
  });
});

// كل heartbeat مكتمل = دقيقة مشاهدة = خصم WATCH_COST_PER_MINUTE.
app.post("/api/store/watch/heartbeat", async (req, res) => {
  const storeUser = await requireStoreUser(
    req,
    res
  );

  if (!storeUser) return;

  const { user } = storeUser;
  const sessionId = req.body?.sessionId;

  if (!sessionId) {
    return res.status(400).json({
      ok: false,
      error: "WATCH_SESSION_REQUIRED"
    });
  }

  const session = getWatchSession(sessionId);

  if (!session) {
    return res.status(404).json({
      ok: false,
      error: "WATCH_SESSION_NOT_FOUND"
    });
  }

  if (
    String(session.kickUserId) !==
    String(user.id)
  ) {
    return res.status(403).json({
      ok: false,
      error: "WATCH_SESSION_FORBIDDEN"
    });
  }

  if (!session.active) {
    return res.status(409).json({
      ok: false,
      error: "WATCH_SESSION_CLOSED"
    });
  }

  const now = Date.now();
  const elapsed =
    now - safeNumber(session.lastHeartbeatAt);

  if (elapsed < WATCH_HEARTBEAT_MS - 5000) {
    return res.json({
      ok: true,
      charged: false,
      reason: "TOO_EARLY",
      balance: safeNumber(user.points),
      nextHeartbeatIn: Math.max(
        0,
        WATCH_HEARTBEAT_MS - elapsed
      )
    });
  }

  if (elapsed > WATCH_SESSION_TIMEOUT_MS) {
    session.active = false;
    saveWatchSessions();

    return res.status(409).json({
      ok: false,
      error: "WATCH_SESSION_EXPIRED"
    });
  }

  // لا نعتمد على العميل وحده: نتأكد من أن البث ما زال Live.
  const live = await isChannelLive();

  if (!live) {
    session.active = false;
    saveWatchSessions();

    return res.status(409).json({
      ok: false,
      error: "STREAM_OFFLINE",
      message: "انتهى البث، وتم إيقاف خصم النقاط."
    });
  }

  const result = spendPoints(
    user.id,
    WATCH_COST_PER_MINUTE,
    "watch-minute"
  );

  if (!result.ok) {
    session.active = false;
    saveWatchSessions();

    return res.status(402).json({
      ok: false,
      error: "INSUFFICIENT_POINTS",
      balance: safeNumber(user.points),
      costPerMinute: WATCH_COST_PER_MINUTE
    });
  }

  session.lastHeartbeatAt = now;
  session.minutesCharged =
    safeNumber(session.minutesCharged) + 1;

  saveWatchSessions();

  res.json({
    ok: true,
    charged: true,
    chargedPoints: WATCH_COST_PER_MINUTE,
    minutesCharged: session.minutesCharged,
    balance: safeNumber(result.user.points),
    nextHeartbeatIn: WATCH_HEARTBEAT_MS
  });
});

// إنهاء جلسة المشاهدة.
app.post("/api/store/watch/stop", async (req, res) => {
  const storeUser = await requireStoreUser(
    req,
    res
  );

  if (!storeUser) return;

  const sessionId = req.body?.sessionId;
  const session = getWatchSession(sessionId);

  if (session) {
    if (
      String(session.kickUserId) !==
      String(storeUser.user.id)
    ) {
      return res.status(403).json({
        ok: false,
        error: "WATCH_SESSION_FORBIDDEN"
      });
    }

    session.active = false;
    saveWatchSessions();
  }

  res.json({
    ok: true,
    balance: safeNumber(
      storeUser.user.points
    )
  });
});

// =====================================================
// STORE - SPEND POINTS FOR A PRODUCT
// =====================================================

// هذا endpoint عام لأي منتج في المتجر.
// لا يسمح بالخصم إذا لم يكن المستخدم مسجلاً بحساب Kick.
app.post("/api/store/spend", async (req, res) => {
  const storeUser = await requireStoreUser(
    req,
    res
  );

  if (!storeUser) return;

  const amount = safeNumber(req.body?.amount);
  const reason =
    String(req.body?.reason || "store-item").slice(
      0,
      100
    );

  if (amount <= 0) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_AMOUNT"
    });
  }

  const result = spendPoints(
    storeUser.user.id,
    amount,
    reason
  );

  if (!result.ok) {
    return res.status(402).json({
      ok: false,
      error: "INSUFFICIENT_POINTS",
      balance: safeNumber(storeUser.user.points),
      required: amount
    });
  }

  res.json({
    ok: true,
    spent: amount,
    balance: safeNumber(result.user.points)
  });
});

// =====================================================
// STORE CONFIG
// =====================================================

app.get("/api/store/config", (req, res) => {
  res.json({
    ok: true,
    channel: KICK_CHANNEL_SLUG,
    channelUrl: KICK_CHANNEL_SLUG
      ? `https://kick.com/${encodeURIComponent(KICK_CHANNEL_SLUG)}`
      : null,
    playerUrl: KICK_CHANNEL_SLUG
      ? `https://player.kick.com/${encodeURIComponent(KICK_CHANNEL_SLUG)}`
      : null,
    watchCostPerMinute: WATCH_COST_PER_MINUTE,
    watchHeartbeatMs: WATCH_HEARTBEAT_MS,
    kickLoginProvider: "custom:kick"
  });
});

// =====================================================
// HOME / HEALTH
// =====================================================

app.get("/", (req, res) => {
  res.send(`
    <!doctype html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Cha9fa Store</title>
      </head>
      <body style="font-family:Arial;background:#111;color:#fff;padding:40px;text-align:center">
        <h1>Cha9fa Store 🎁</h1>
        <p>Kick points system: ONLINE ✅</p>
        <p>Users: ${Object.keys(users).length}</p>
        <p>Watch cost: ${WATCH_COST_PER_MINUTE} points / minute</p>
        <p>Channel: ${escapeHtml(KICK_CHANNEL_SLUG || "not configured")}</p>
        <p><a href="/auth/kick" style="color:#53ff1a">ربط حساب البوت بـ Kick</a></p>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    bot: "cha9fa-store-kick",
    users: Object.keys(users).length,
    botToken: Boolean(tokens.access_token),
    kickOAuthConfigured: Boolean(
      CLIENT_ID && CLIENT_SECRET && REDIRECT_URI
    ),
    webhookConfigured: Boolean(WEBHOOK_URL),
    supabaseConfigured: Boolean(
      SUPABASE_URL && SUPABASE_ANON_KEY
    ),
    channel: KICK_CHANNEL_SLUG || null,
    watchCostPerMinute: WATCH_COST_PER_MINUTE
  });
});

// =====================================================
// DEBUG
// =====================================================

function requireDebugAccess(req, res) {
  if (!DEBUG_KEY) {
    res.status(404).end();
    return false;
  }

  const supplied = String(req.headers["x-debug-key"] || "");
  if (!timingSafeEqual(supplied, DEBUG_KEY)) {
    res.status(403).json({ ok: false, error: "FORBIDDEN" });
    return false;
  }

  return true;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

app.get("/debug/users", (req, res) => {
  if (!requireDebugAccess(req, res)) return;
  res.json({
    total: Object.keys(users).length,
    users: Object.values(users).map(sanitizeUser)
  });
});

app.get("/debug/watch", (req, res) => {
  if (!requireDebugAccess(req, res)) return;
  res.json({
    total: Object.keys(watchSessions).length,
    sessions: watchSessions
  });
});

// =====================================================
// START
// =====================================================

cleanupProcessedEvents();
cleanupWatchSessions();

app.listen(PORT, "0.0.0.0", () => {
  console.log("========================================");
  console.log("CHA9FA STORE / KICK SERVER ONLINE");
  console.log(`PORT: ${PORT}`);
  console.log(`Webhook: ${WEBHOOK_URL}`);
  console.log(`Channel: ${KICK_CHANNEL_SLUG || "NOT SET"}`);
  console.log(`Points/message: ${POINTS_PER_MESSAGE}`);
  console.log(`Follow points: ${FOLLOW_POINTS}`);
  console.log(`Subscription points: ${SUB_POINTS}`);
  console.log(
    `Watch cost/minute: ${WATCH_COST_PER_MINUTE}`
  );
  console.log(
    `Watch heartbeat: ${WATCH_HEARTBEAT_MS / 1000}s`
  );
  console.log("========================================");
});
