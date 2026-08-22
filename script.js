/* Cha9fa Store - unified browser + Node/Render script */
(() => {
  const IS_BROWSER = typeof window !== "undefined" && typeof document !== "undefined";

  if (!IS_BROWSER) {
    const express = require("express");
    const crypto = require("crypto");
    const fs = require("fs");
    const path = require("path");

    const app = express();
    const PORT = Number(process.env.PORT || 3000);
    const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    const CLIENT_ID = String(process.env.KICK_CLIENT_ID || "").trim();
    const CLIENT_SECRET = String(process.env.KICK_CLIENT_SECRET || "").trim();
    const REDIRECT_URI = String(
      process.env.KICK_REDIRECT_URI ||
      process.env.KICK_BOT_REDIRECT_URI ||
      (PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/auth/kick/callback` : "")
    ).trim();
    const WEBHOOK_URL = String(
      process.env.KICK_WEBHOOK_URL ||
      (PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/webhook/kick` : "")
    ).trim();
    const KICK_CHANNEL_SLUG = String(process.env.KICK_CHANNEL_SLUG || "").trim().replace(/^@/, "").toLowerCase();
    const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://dopjzxjhyrgnrvpuboiv.supabase.co").trim().replace(/\/$/, "");
    const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
    const POINTS_PER_MESSAGE = Math.max(0, Number(process.env.POINTS_PER_MESSAGE || 5));
    const MESSAGE_COOLDOWN = Math.max(0, Number(process.env.MESSAGE_COOLDOWN_MS || 60000));
    const FOLLOW_POINTS = Math.max(0, Number(process.env.FOLLOW_POINTS || 100));
    const SUB_POINTS = Math.max(0, Number(process.env.SUB_POINTS || 250));
    const WATCH_COST_PER_MINUTE = Math.max(0, Number(process.env.WATCH_COST_PER_MINUTE || 10));
    const WATCH_HEARTBEAT_MS = Math.max(10000, Number(process.env.WATCH_HEARTBEAT_MS || 60000));
    const WATCH_TIMEOUT_MS = Math.max(WATCH_HEARTBEAT_MS + 15000, Number(process.env.WATCH_SESSION_TIMEOUT_MS || 180000));
    const WEBHOOK_MAX_AGE_MS = Math.max(30000, Number(process.env.WEBHOOK_MAX_AGE_MS || 300000));
    const DEBUG_KEY = String(process.env.DEBUG_KEY || "").trim();
    const BOT_SCOPES = String(process.env.KICK_BOT_SCOPES || "user:read channel:read chat:write events:subscribe").trim().replace(/\s+/g, " ");

    const DATA_DIR = path.join(__dirname, "data");
    const FILES = {
      users: path.join(DATA_DIR, "users.json"),
      tokens: path.join(DATA_DIR, "tokens.json"),
      events: path.join(DATA_DIR, "processed-events.json"),
      watch: path.join(DATA_DIR, "watch-sessions.json")
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const load = (file, fallback) => {
      try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; }
      catch (e) { console.error("DB read:", e.message); return fallback; }
    };
    const save = (file, value) => {
      try {
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
        fs.renameSync(tmp, file);
      } catch (e) { console.error("DB write:", e.message); }
    };
    const safeNumber = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
    const esc = v => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
    const timingEqual = (a,b) => {
      const x=Buffer.from(String(a||"")), y=Buffer.from(String(b||""));
      return x.length===y.length && crypto.timingSafeEqual(x,y);
    };

    let users = load(FILES.users, {});
    let tokens = load(FILES.tokens, { access_token:null, refresh_token:null, expires_at:0 });
    let events = load(FILES.events, {});
    let watches = load(FILES.watch, {});
    const oauth = new Map();
    let refreshPromise = null;
    let kickPublicKey = null;

    const user = (id, username) => {
      id = String(id);
      if (!users[id]) users[id] = { id, username: username || "Unknown", points:0, messages:0, lastPointTime:0, followRewarded:false, subscriptionRewarded:false, supabaseUserId:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
      if (username) users[id].username = String(username);
      users[id].updatedAt = new Date().toISOString();
      return users[id];
    };
    const addPoints = (id, username, amount, reason) => {
      const u=user(id,username), n=Math.max(0,safeNumber(amount));
      u.points=Math.max(0,safeNumber(u.points)+n); u.updatedAt=new Date().toISOString(); save(FILES.users,users);
      if(n) console.log(`[POINTS] ${u.username} +${n} (${reason||"manual"}) => ${u.points}`);
      return u;
    };
    const spend = (id, amount, reason) => {
      const u=user(id), n=Math.max(0,safeNumber(amount));
      if(n<=0) return {ok:true,user:u};
      if(safeNumber(u.points)<n) return {ok:false,user:u,error:"INSUFFICIENT_POINTS"};
      u.points-=n; u.updatedAt=new Date().toISOString(); save(FILES.users,users);
      console.log(`[SPEND] ${u.username} -${n} (${reason||"store"}) => ${u.points}`);
      return {ok:true,user:u};
    };
    const rank = id => {
      const list=Object.values(users).sort((a,b)=>safeNumber(b.points)-safeNumber(a.points));
      const i=list.findIndex(u=>String(u.id)===String(id)); return i<0?null:i+1;
    };
    const publicUser = u => u ? ({id:String(u.id),username:u.username||"Unknown",points:safeNumber(u.points),messages:safeNumber(u.messages),rank:rank(u.id),followRewarded:!!u.followRewarded,subscriptionRewarded:!!u.subscriptionRewarded}) : null;
    const getSupabaseUser = async token => {
      if(!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return null;
      const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`} });
      return r.ok ? r.json() : null;
    };
    const requireSupabase = async (req,res) => {
      const h=String(req.headers.authorization||"");
      if(!h.startsWith("Bearer ")) { res.status(401).json({ok:false,error:"KICK_LOGIN_REQUIRED"}); return null; }
      try { const u=await getSupabaseUser(h.slice(7).trim()); if(!u){res.status(401).json({ok:false,error:"INVALID_SUPABASE_SESSION"});return null;} return u; }
      catch(e){console.error(e);res.status(500).json({ok:false,error:"AUTH_SERVICE_ERROR"});return null;}
    };
    const kickFromSupabase = s => {
      const m=s?.user_metadata||{}, ids=Array.isArray(s?.identities)?s.identities:[];
      const i=ids.find(x=>["kick","custom:kick"].includes(String(x.provider||"").toLowerCase()));
      const d=i?.identity_data||{};
      const id=d.user_id||d.sub||m.user_id||m.sub;
      const name=d.username||d.preferred_username||m.username||m.preferred_username;
      return id ? {id:String(id),username:name||"Kick User"} : null;
    };
    const requireStore = async (req,res) => {
      const s=await requireSupabase(req,res); if(!s) return null;
      let u=Object.values(users).find(x=>String(x.supabaseUserId||"")===String(s.id));
      if(!u) { const k=kickFromSupabase(s); if(k){u=user(k.id,k.username);u.supabaseUserId=s.id;save(FILES.users,users);} }
      if(!u){res.status(403).json({ok:false,error:"KICK_LINK_REQUIRED",message:"يجب تسجيل الدخول بحساب Kick وربطه بالمتجر أولاً."});return null;}
      return {supabaseUser:s,user:u};
    };

    app.disable("x-powered-by");
    app.set("trust proxy",1);
    app.use(express.json({limit:"1mb",verify:(req,res,b)=>{req.rawBody=Buffer.from(b);}}));
    app.use(express.static(__dirname, { index:false }));

    app.get("/api/store/config",(req,res)=>res.json({
      ok:true,
      channel:KICK_CHANNEL_SLUG,
      channelUrl:KICK_CHANNEL_SLUG?`https://kick.com/${encodeURIComponent(KICK_CHANNEL_SLUG)}`:null,
      playerUrl:KICK_CHANNEL_SLUG?`https://player.kick.com/${encodeURIComponent(KICK_CHANNEL_SLUG)}`:null,
      watchCostPerMinute:WATCH_COST_PER_MINUTE,
      heartbeatMs:WATCH_HEARTBEAT_MS,
      supabaseUrl:SUPABASE_URL,
      supabaseAnonKey:SUPABASE_ANON_KEY,
      kickProvider:"custom:kick"
    }));

    app.get("/auth/kick",(req,res)=>{
      if(!CLIENT_ID||!REDIRECT_URI) return res.status(500).send("KICK_CLIENT_ID و KICK_REDIRECT_URI مطلوبان.");
      const state=crypto.randomBytes(32).toString("hex"), verifier=crypto.randomBytes(64).toString("hex");
      oauth.set(state,{verifier,createdAt:Date.now()});
      const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
      const q=new URLSearchParams({response_type:"code",client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,scope:BOT_SCOPES,state,code_challenge:challenge,code_challenge_method:"S256"});
      res.redirect(`https://id.kick.com/oauth/authorize?${q}`);
    });

    app.get("/auth/kick/callback",async(req,res)=>{
      const {code,state,error}=req.query;
      if(error) return res.status(400).send(`Kick OAuth Error: ${esc(error)}`);
      const a=oauth.get(String(state||""));
      if(!code||!a||Date.now()-a.createdAt>10*60*1000) return res.status(400).send("OAuth state/code غير صالح أو منتهي.");
      oauth.delete(String(state));
      try{
        const r=await fetch("https://id.kick.com/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code:String(code),client_id:CLIENT_ID,client_secret:CLIENT_SECRET,redirect_uri:REDIRECT_URI,code_verifier:a.verifier})});
        const d=await r.json(); if(!r.ok) return res.status(400).send(`<pre>${esc(JSON.stringify(d,null,2))}</pre>`);
        tokens={access_token:d.access_token,refresh_token:d.refresh_token||tokens.refresh_token,expires_at:Date.now()+safeNumber(d.expires_in,3600)*1000}; save(FILES.tokens,tokens);
        res.send(`<html lang="ar" dir="rtl"><meta charset="utf-8"><body style="font-family:Arial;text-align:center;padding:50px"><h1>تم ربط Kick بنجاح ✅</h1><p>يمكنك الآن العودة للمتجر.</p><a href="/">العودة</a></body></html>`);
      }catch(e){console.error(e);res.status(500).send("OAuth error");}
    });

    const refreshToken = async () => {
      if(!tokens.refresh_token) throw new Error("No refresh token");
      if(refreshPromise) return refreshPromise;
      refreshPromise=(async()=>{
        const r=await fetch("https://id.kick.com/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:tokens.refresh_token,client_id:CLIENT_ID,client_secret:CLIENT_SECRET})});
        const d=await r.json(); if(!r.ok) throw new Error(`Refresh failed: ${JSON.stringify(d)}`);
        tokens.access_token=d.access_token; if(d.refresh_token) tokens.refresh_token=d.refresh_token; tokens.expires_at=Date.now()+safeNumber(d.expires_in,3600)*1000; save(FILES.tokens,tokens); return tokens.access_token;
      })().finally(()=>{refreshPromise=null;});
      return refreshPromise;
    };
    const accessToken = async () => {
      if(!tokens.access_token) throw new Error("Bot is not authenticated");
      return Date.now()>safeNumber(tokens.expires_at)-120000 ? refreshToken() : tokens.access_token;
    };
    const kickApi = async (endpoint,options={}) => {
      let t=await accessToken();
      let r=await fetch(`https://api.kick.com${endpoint}`,{...options,headers:{Accept:"application/json",...(options.headers||{}),Authorization:`Bearer ${t}`}});
      if(r.status===401&&tokens.refresh_token){t=await refreshToken();r=await fetch(`https://api.kick.com${endpoint}`,{...options,headers:{Accept:"application/json",...(options.headers||{}),Authorization:`Bearer ${t}`}});}
      return r;
    };
    const channelInfo = async () => {
      const r=await kickApi("/public/v1/channels"),d=await r.json(); if(!r.ok) throw new Error(JSON.stringify(d));
      const list=Array.isArray(d.data)?d.data:[]; return (KICK_CHANNEL_SLUG?list.find(x=>String(x.slug||"").toLowerCase()===KICK_CHANNEL_SLUG):null)||list[0]||null;
    };
    const channelId = async () => { const c=await channelInfo(); return c?.broadcaster_user_id||c?.user_id||c?.id||null; };
    const isLive = async () => { try { const c=await channelInfo(); return !!(c?.stream?.is_live); } catch(e){console.error("Live check:",e.message);return false;} };
    const sendChat = async message => {
      const id=await channelId(); if(!id) return false;
      const r=await kickApi("/public/v1/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({broadcaster_user_id:Number(id),content:String(message),type:"user"})});
      return r.ok;
    };

    app.post("/api/store/link-kick",async(req,res)=>{
      const s=await requireSupabase(req,res); if(!s)return;
      const pt=req.body?.provider_token;
      if(!pt)return res.status(400).json({ok:false,error:"KICK_PROVIDER_TOKEN_REQUIRED"});
      try{
        const r=await fetch("https://api.kick.com/public/v1/users",{headers:{Authorization:`Bearer ${pt}`,Accept:"application/json"}});
        const d=await r.json(); if(!r.ok)return res.status(401).json({ok:false,error:"INVALID_KICK_PROVIDER_TOKEN"});
        const k=Array.isArray(d.data)?d.data[0]:d.data,id=k?.user_id||k?.id,name=k?.username||k?.slug||"Kick User";
        if(!id)return res.status(400).json({ok:false,error:"KICK_USER_NOT_FOUND"});
        const u=user(id,name);u.supabaseUserId=s.id;save(FILES.users,users);
        res.json({ok:true,kickUser:{id:String(id),username:name},user:publicUser(u)});
      }catch(e){console.error(e);res.status(500).json({ok:false,error:"KICK_LINK_ERROR"});}
    });

    app.get("/api/store/me",async(req,res)=>{
      const x=await requireStore(req,res); if(!x)return;
      res.json({ok:true,authenticated:true,user:publicUser(x.user),watch:{costPerMinute:WATCH_COST_PER_MINUTE,heartbeatMs:WATCH_HEARTBEAT_MS,channel:KICK_CHANNEL_SLUG}});
    });
    app.get("/api/store/follow-status",async(req,res)=>{
      const x=await requireStore(req,res); if(!x)return;
      res.json({ok:true,followed:!!x.user.followRewarded,followRequired:true,followUrl:KICK_CHANNEL_SLUG?`https://kick.com/${encodeURIComponent(KICK_CHANNEL_SLUG)}`:"https://kick.com/"});
    });
    app.post("/api/store/spend",async(req,res)=>{
      const x=await requireStore(req,res); if(!x)return;
      const amount=Math.max(0,safeNumber(req.body?.amount)),reason=String(req.body?.reason||"store-item").slice(0,100);
      if(amount<=0)return res.status(400).json({ok:false,error:"INVALID_AMOUNT"});
      const r=spend(x.user.id,amount,reason);
      if(!r.ok)return res.status(402).json({ok:false,error:"INSUFFICIENT_POINTS",balance:safeNumber(x.user.points),required:amount});
      res.json({ok:true,spent:amount,balance:safeNumber(r.user.points)});
    });

    app.post("/api/store/watch/start",async(req,res)=>{
      const x=await requireStore(req,res); if(!x)return;
      if(!KICK_CHANNEL_SLUG)return res.status(500).json({ok:false,error:"KICK_CHANNEL_SLUG_MISSING"});
      if(!(await isLive()))return res.status(409).json({ok:false,error:"STREAM_OFFLINE"});
      const id=`watch_${crypto.randomBytes(16).toString("hex")}`,now=Date.now();
      watches[id]={id,kickUserId:String(x.user.id),supabaseUserId:String(x.supabaseUser.id),startedAt:now,lastHeartbeatAt:now,minutesCharged:0,active:true}; save(FILES.watch,watches);
      res.json({ok:true,sessionId:id,costPerMinute:WATCH_COST_PER_MINUTE,heartbeatMs:WATCH_HEARTBEAT_MS,balance:safeNumber(x.user.points),channel:KICK_CHANNEL_SLUG});
    });
    app.post("/api/store/watch/heartbeat",async(req,res)=>{
      const x=await requireStore(req,res); if(!x)return;
      const s=watches[String(req.body?.sessionId||"")]; if(!s)return res.status(404).json({ok:false,error:"WATCH_SESSION_NOT_FOUND"});
      if(String(s.kickUserId)!==String(x.user.id))return res.status(403).json({ok:false,error:"WATCH_SESSION_FORBIDDEN"});
      if(!s.active)return res.status(409).json({ok:false,error:"WATCH_SESSION_CLOSED"});
      const now=Date.now(),elapsed=now-safeNumber(s.lastHeartbeatAt);
      if(elapsed<WATCH_HEARTBEAT_MS-5000)return res.json({ok:true,charged:false,reason:"TOO_EARLY",balance:safeNumber(x.user.points),nextHeartbeatIn:WATCH_HEARTBEAT_MS-elapsed});
      if(elapsed>WATCH_TIMEOUT_MS){s.active=false;save(FILES.watch,watches);return res.status(409).json({ok:false,error:"WATCH_SESSION_EXPIRED"});}
      if(!(await isLive())){s.active=false;save(FILES.watch,watches);return res.status(409).json({ok:false,error:"STREAM_OFFLINE"});}
      const r=spend(x.user.id,WATCH_COST_PER_MINUTE,"watch-minute");
      if(!r.ok){s.active=false;save(FILES.watch,watches);return res.status(402).json({ok:false,error:"INSUFFICIENT_POINTS",balance:safeNumber(x.user.points),costPerMinute:WATCH_COST_PER_MINUTE});}
      s.lastHeartbeatAt=now;s.minutesCharged=safeNumber(s.minutesCharged)+1;save(FILES.watch,watches);
      res.json({ok:true,charged:true,chargedPoints:WATCH_COST_PER_MINUTE,minutesCharged:s.minutesCharged,balance:safeNumber(r.user.points),nextHeartbeatIn:WATCH_HEARTBEAT_MS});
    });
    app.post("/api/store/watch/stop",async(req,res)=>{
      const x=await requireStore(req,res); if(!x)return;
      const s=watches[String(req.body?.sessionId||"")];
      if(s){if(String(s.kickUserId)!==String(x.user.id))return res.status(403).json({ok:false,error:"WATCH_SESSION_FORBIDDEN"});s.active=false;save(FILES.watch,watches);}
      res.json({ok:true,balance:safeNumber(x.user.points)});
    });

    app.get("/health",(req,res)=>res.json({status:"online",botToken:!!tokens.access_token,supabaseConfigured:!!SUPABASE_ANON_KEY,channel:KICK_CHANNEL_SLUG||null}));
    app.get("/debug/users",(req,res)=>{if(!DEBUG_KEY||!timingEqual(req.headers["x-debug-key"],DEBUG_KEY))return res.status(403).json({ok:false,error:"FORBIDDEN"});res.json({total:Object.keys(users).length,users:Object.values(users).map(publicUser)});});

    const webhookKey = async () => {
      if(kickPublicKey)return kickPublicKey;
      const r=await fetch("https://api.kick.com/public/v1/public-key"),d=await r.json(); kickPublicKey=d.data?.public_key||d.public_key||null; return kickPublicKey;
    };
    const verifyWebhook = async req => {
      const id=req.headers["kick-event-message-id"],ts=req.headers["kick-event-message-timestamp"],sig=req.headers["kick-event-signature"];
      if(!id||!ts||!sig||!req.rawBody)return false;
      const t=Date.parse(String(ts)); if(Number.isFinite(t)&&Math.abs(Date.now()-t)>WEBHOOK_MAX_AGE_MS)return false;
      const key=await webhookKey(); if(!key)return false;
      const v=crypto.createVerify("RSA-SHA256"); v.update(`${id}.${ts}.${req.rawBody.toString()}`); v.end();
      return v.verify(key,Buffer.from(String(sig),"base64"));
    };
    app.post("/webhook/kick",async(req,res)=>{
      if(!(await verifyWebhook(req)))return res.status(401).send("Invalid signature");
      const eventId=String(req.headers["kick-event-message-id"]||""); if(events[eventId])return res.sendStatus(200);
      events[eventId]=Date.now();save(FILES.events,events);
      const type=String(req.headers["kick-event-type"]||"");
      if(type==="chat.message.sent"){
        const s=req.body?.sender||{},id=s.user_id||s.id,name=s.username||s.slug||"Viewer",message=req.body?.content||"";
        if(id){const u=user(id,name);u.messages=safeNumber(u.messages)+1;if(Date.now()-safeNumber(u.lastPointTime)>=MESSAGE_COOLDOWN){u.lastPointTime=Date.now();addPoints(id,name,POINTS_PER_MESSAGE,"chat-message");}else save(FILES.users,users);await chatCommand(id,name,message);}
      } else if(type==="channel.followed"){
        const f=req.body?.user||req.body?.follower||{},id=f.user_id||f.id,name=f.username||f.slug||"Viewer";
        if(id){const u=user(id,name);if(!u.followRewarded){u.followRewarded=true;save(FILES.users,users);addPoints(id,name,FOLLOW_POINTS,"follow");await sendChat(`@${name} شكراً على المتابعة. حصلت على ${FOLLOW_POINTS} نقطة.`);}}
      } else if(["channel.subscription.new","channel.subscription.renewal","channel.subscription.gifts"].includes(type)){
        const s=req.body?.subscriber||req.body?.user||{},id=s.user_id||s.id,name=s.username||s.slug||"Viewer";
        if(id&&type==="channel.subscription.new"){const u=user(id,name);if(!u.subscriptionRewarded){u.subscriptionRewarded=true;save(FILES.users,users);addPoints(id,name,SUB_POINTS,"subscription");await sendChat(`@${name} شكراً على الاشتراك. حصلت على ${SUB_POINTS} نقطة.`);}}
      }
      res.sendStatus(200);
    });
    async function chatCommand(id,name,message){
      const c=String(message||"").trim().toLowerCase(),u=user(id,name);
      if(c==="!points"||c==="!نقاطي")return sendChat(`@${name} لديك ${safeNumber(u.points).toLocaleString()} نقطة.`);
      if(c==="!rank")return sendChat(`@${name} ترتيبك الحالي: #${rank(id)||"-"}`);
      if(c==="!top"){const top=Object.values(users).sort((a,b)=>safeNumber(b.points)-safeNumber(a.points)).slice(0,5);return sendChat(`أفضل 5: ${top.map((x,i)=>`${i+1}. ${x.username}: ${x.points}`).join(" | ")}`);}
      if(c==="!stats")return sendChat(`@${name} نقاطك: ${safeNumber(u.points).toLocaleString()} | رسائلك: ${safeNumber(u.messages)}`);
      if(c==="!ping")return sendChat(`@${name} Pong! البوت يعمل.`);
      if(c==="!help")return sendChat("الأوامر: !points | !نقاطي | !rank | !top | !stats | !ping | !help");
    }

    app.use((req,res)=>{
      if(req.path.startsWith("/api/")||req.path.startsWith("/auth/")||req.path.startsWith("/webhook/")||req.path==="/health")return res.status(404).end();
      res.sendFile(path.join(__dirname,"index.html"));
    });
    app.listen(PORT,"0.0.0.0",()=>console.log(`Cha9fa Store server listening on ${PORT}`));
    return;
  }

  const state = {
    products:[
      {id:1,name:"منتج تجريبي 1",price:300,icon:"🔥"},
      {id:2,name:"منتج تجريبي 2",price:900,icon:"⭐"},
      {id:3,name:"منتج تجريبي 3",price:1500,icon:"🎁"},
      {id:4,name:"منتج تجريبي 4",price:3000,icon:"💎"}
    ],
    cart:[],supabase:null,session:null,me:null,config:null,watch:null,heartbeat:null
  };
  const $=id=>document.getElementById(id);
  const format=n=>`${Number(n||0).toLocaleString("ar-DZ")} نقطة`;
  const escapeHtml=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function render(list=state.products){
    const grid=$("productsGrid");if(!grid)return;
    grid.innerHTML=list.map(p=>`<article class="card"><div class="product-img">${p.icon}</div><h3>${escapeHtml(p.name)}</h3><div class="price">${format(p.price)}</div><button class="add" data-add="${p.id}">أضف إلى السلة</button></article>`).join("");
    grid.querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",()=>addToCart(Number(b.dataset.add))));
  }
  function addToCart(id){const p=state.products.find(x=>x.id===id);if(p){state.cart.push(p);updateCart();}}
  function removeItem(i){state.cart.splice(i,1);updateCart();}
  function updateCart(){
    $("cartCount").textContent=state.cart.length;
    $("cartItems").innerHTML=state.cart.length?state.cart.map((p,i)=>`<div class="cart-item"><span>${escapeHtml(p.name)}</span><span>${format(p.price)} <button data-remove="${i}">✕</button></span></div>`).join(""):"<p style='color:#9ca3af'>السلة فارغة.</p>";
    $("cartItems").querySelectorAll("[data-remove]").forEach(b=>b.addEventListener("click",()=>removeItem(Number(b.dataset.remove))));
    $("cartTotal").textContent=format(state.cart.reduce((s,p)=>s+p.price,0));
    localStorage.setItem("cha9fa_cart",JSON.stringify(state.cart));
  }
  function openCart(){$("cartPanel").classList.add("open");$("overlay").classList.add("show");}
  function closeCart(){$("cartPanel").classList.remove("open");$("overlay").classList.remove("show");}

  async function loadSupabase(){
    if(state.supabase)return state.supabase;
    if(!state.config?.supabaseUrl||!state.config?.supabaseAnonKey)throw new Error("Supabase configuration is missing on the server.");
    await new Promise((resolve,reject)=>{
      if(window.supabase?.createClient)return resolve();
      const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";s.onload=resolve;s.onerror=()=>reject(new Error("تعذر تحميل Supabase."));document.head.appendChild(s);
    });
    state.supabase=window.supabase.createClient(state.config.supabaseUrl,state.config.supabaseAnonKey);
    return state.supabase;
  }
  function injectAuthUI(){
    const header=document.querySelector(".header");if(!header||$("kickAuthBox"))return;
    const box=document.createElement("div");box.id="kickAuthBox";box.style.cssText="display:flex;align-items:center;gap:8px;margin-inline:auto 12px;font-size:14px";
    box.innerHTML=`<span id="pointsBadge" style="display:none;padding:8px 12px;border-radius:999px;background:#1d2b17;color:#8cff4d;font-weight:700"></span><button id="kickLogin" class="primary" style="border:0;cursor:pointer">تسجيل الدخول بـ Kick</button>`;
    header.insertBefore(box,header.lastElementChild);$("kickLogin").addEventListener("click",loginKick);
  }
  async function loginKick(){
    try{const s=await loadSupabase();const r=await s.auth.signInWithOAuth({provider:"custom:kick",options:{redirectTo:window.location.origin}});if(r.error)throw r.error;}
    catch(e){alert(e.message||"تعذر تسجيل الدخول عبر Kick.");}
  }
  async function refreshMe(){
    const badge=$("pointsBadge"),login=$("kickLogin");
    if(!state.session){if(badge)badge.style.display="none";if(login){login.textContent="تسجيل الدخول بـ Kick";login.disabled=false;login.style.opacity="1";}return;}
    const r=await fetch("/api/store/me",{headers:{Authorization:`Bearer ${state.session.access_token}`}});
    if(r.ok){const d=await r.json();state.me=d.user;if(badge){badge.textContent=format(state.me.points);badge.style.display="inline-block";}if(login){login.textContent=`مرحباً ${state.me.username}`;login.disabled=true;login.style.opacity=".85";}}
    else if(r.status===403&&login){login.disabled=false;login.textContent="ربط حساب Kick";}
  }
  async function refreshSession(){
    const s=await loadSupabase();
    const {data,error}=await s.auth.getSession();if(error)throw error;
    state.session=data.session;await refreshMe();
    s.auth.onAuthStateChange((_event,session)=>{state.session=session;refreshMe().catch(console.error);});
  }
  async function checkout(){
    if(!state.cart.length)return alert("السلة فارغة.");
    if(!state.session)return loginKick();
    const total=state.cart.reduce((s,p)=>s+p.price,0);
    if(!confirm(`سيتم خصم ${format(total)}. هل تريد المتابعة؟`))return;
    const r=await fetch("/api/store/spend",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${state.session.access_token}`},body:JSON.stringify({amount:total,reason:"store-checkout"})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){if(d.error==="INSUFFICIENT_POINTS")return alert(`رصيدك غير كافٍ. الرصيد الحالي: ${format(d.balance)}`);if(d.error==="KICK_LINK_REQUIRED")return alert("سجّل الدخول بحساب Kick ثم أعد المحاولة.");return alert(d.message||"تعذر إتمام الطلب.");}
    state.cart=[];updateCart();await refreshMe();closeCart();alert("تم خصم النقاط بنجاح ✅");
  }
  async function startWatch(){
    if(!state.session)return loginKick();
    if(state.watch?.sessionId)return;
    const r=await fetch("/api/store/watch/start",{method:"POST",headers:{Authorization:`Bearer ${state.session.access_token}`}}),d=await r.json().catch(()=>({}));
    if(!r.ok)return alert(d.error==="STREAM_OFFLINE"?"البث غير مباشر حالياً.":(d.message||"تعذر بدء المشاهدة."));
    state.watch=d;
    const area=$("watchArea");if(area)area.innerHTML=`<div style="background:#000;border-radius:16px;overflow:hidden"><iframe src="https://player.kick.com/${encodeURIComponent(d.channel)}" style="width:100%;height:420px;border:0" allowfullscreen></iframe></div><button id="stopWatch" class="primary" style="margin-top:10px">إيقاف المشاهدة</button>`;
    $("stopWatch").onclick=stopWatch;state.heartbeat=setInterval(sendHeartbeat,d.heartbeatMs);await refreshMe();
  }
  async function sendHeartbeat(){
    if(!state.watch||!state.session)return;
    const r=await fetch("/api/store/watch/heartbeat",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${state.session.access_token}`},body:JSON.stringify({sessionId:state.watch.sessionId})}),d=await r.json().catch(()=>({}));
    if(!r.ok){clearInterval(state.heartbeat);state.heartbeat=null;state.watch=null;alert(d.error==="INSUFFICIENT_POINTS"?"انتهت نقاطك. تم إيقاف المشاهدة.":d.error==="STREAM_OFFLINE"?"انتهى البث.":d.message||"انتهت جلسة المشاهدة.");return;}
    if(d.charged)await refreshMe();
  }
  async function stopWatch(){
    if(state.heartbeat){clearInterval(state.heartbeat);state.heartbeat=null;}
    if(state.watch&&state.session)await fetch("/api/store/watch/stop",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${state.session.access_token}`},body:JSON.stringify({sessionId:state.watch.sessionId})}).catch(()=>{});
    state.watch=null;const area=$("watchArea");if(area)area.innerHTML="";
  }
  function injectWatchUI(){
    if($("watchArea"))return;
    const section=document.createElement("section");section.className="section";section.id="watchSection";section.innerHTML=`<div class="section-head"><h2>مشاهدة Kick</h2><button id="startWatch" class="primary">ابدأ المشاهدة</button></div><div id="watchArea"><p style="color:#9ca3af">سجّل الدخول بـ Kick لبدء جلسة المشاهدة.</p></div>`;
    document.querySelector("main")?.appendChild(section);$("startWatch").onclick=startWatch;
  }
  async function init(){
    try{
      const r=await fetch("/api/store/config");state.config=await r.json();
      injectAuthUI();injectWatchUI();
      try{const saved=JSON.parse(localStorage.getItem("cha9fa_cart")||"[]");state.cart=Array.isArray(saved)?saved:[];}catch{state.cart=[];}
      render();updateCart();
      $("cartBtn").onclick=openCart;$("closeCart").onclick=closeCart;$("overlay").onclick=closeCart;$("checkout").onclick=checkout;
      $("search").addEventListener("input",e=>{const q=e.target.value.trim().toLowerCase();render(state.products.filter(p=>p.name.toLowerCase().includes(q)));});
      try{await refreshSession();}catch(e){console.warn("Auth init:",e.message);}
    }catch(e){console.error(e);render();updateCart();}
  }
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",init):init();
})();
