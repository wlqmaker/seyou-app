// SeeYou 轻后端：Node 原生 http，零第三方依赖（云端可选 @cloudbase/node-sdk）
// 启动： node server.js   （默认端口 3000，可用 PORT 环境变量覆盖）
// 存储：检测到 CloudBase 环境则用云数据库(数据持久) + 云存储(照片)，否则回退本地文件
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_FILE = process.env.DB_FILE || path.join(ROOT, "db.json");
const UPLOAD_DIR = path.join(ROOT, "uploads");

// ==== CloudBase 环境检测（云托管中 SDK 通过环境凭证免密初始化）====
const TCB_ENV = process.env.TCB_ENV || process.env.CLOUDBASE_ENV || process.env.SCF_NAMESPACE || "";
const TCB_COLLECTION = process.env.TCB_COLLECTION || "seeyou_relations";
let USE_TCB = false;
let tcbApp = null;
let tcbDb = null;

let db = { relations: {} };

function initTcb() {
  if (!TCB_ENV) return false;
  try {
    // 防御：@cloudbase/node-sdk 可能未安装(npm install 失败/超时)，require 不能崩主进程
    const cloudbase = require("@cloudbase/node-sdk");
    if (!cloudbase || !cloudbase.init) { console.warn("[SeeYou] @cloudbase/node-sdk 加载异常，回退本地"); return false; }
    tcbApp = cloudbase.init({ env: TCB_ENV });
    tcbDb = tcbApp.database();
    USE_TCB = true;
    console.log("[SeeYou] 存储模式：CloudBase 云数据库，集合 =", TCB_COLLECTION, "env =", TCB_ENV);
    return true;
  } catch (e) {
    console.warn("[SeeYou] CloudBase 初始化失败，回退本地文件存储：", e && e.message);
    USE_TCB = false;
    return false;
  }
}

async function loadDb() {
  if (USE_TCB) {
    try {
      db = { relations: {} };
      let skip = 0; const limit = 100;
      while (true) {
        const r = await tcbDb.collection(TCB_COLLECTION).skip(skip).limit(limit).get();
        const list = (r && r.data) || [];
        list.forEach(function (doc) { if (doc && doc._id) db.relations[doc._id] = doc; });
        if (list.length < limit) break;
        skip += limit;
      }
      console.log("[SeeYou] 已从云数据库加载关系数：", Object.keys(db.relations).length);
    } catch (e) {
      console.warn("[SeeYou] 从云数据库加载失败：", e && e.message);
      db = { relations: {} };
    }
    return;
  }
  try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) { db = { relations: {} }; }
}

function saveDb(rid) {
  if (USE_TCB) {
    if (!rid || !db.relations[rid]) return;
    const doc = db.relations[rid];
    doc._id = rid;
    tcbDb.collection(TCB_COLLECTION).doc(rid).set(doc).catch(function (e) {
      console.warn("[SeeYou] 云数据库写入失败 rid=" + rid + "：", e && e.message);
    });
    return;
  }
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
}

function ensureUploadDir() {
  try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
}

function readRaw(req) {
  return new Promise(function (resolve) {
    const chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
  });
}

// 从 base64 dataUrl 或原始二进制解析出 { buffer, ext }
function parseImage(raw, contentType) {
  if (contentType && contentType.indexOf("application/json") !== -1) {
    let data = "";
    try { data = (typeof raw === "string" ? JSON.parse(raw).data : (raw && raw.data)) || ""; } catch (e) { data = ""; }
    const m = String(data).match(/^data:image\/(\w+);base64,(.*)$/);
    if (m) {
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      return { buffer: Buffer.from(m[2], "base64"), ext: ext };
    }
    if (typeof data === "string" && /^[A-Za-z0-9+/=]+$/.test(data)) {
      return { buffer: Buffer.from(data, "base64"), ext: "jpg" };
    }
    return null;
  }
  const extMap = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp" };
  const ext = extMap[(contentType || "").split(";")[0]] || "jpg";
  return { buffer: Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "binary"), ext: ext };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function mergeById(arr, inc) {
  inc = inc || [];
  var map = {};
  (arr || []).forEach(function (x) { if (x && x.id) map[x.id] = x; });
  inc.forEach(function (x) { if (x && x.id) map[x.id] = x; });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(function (resolve) {
    var d = "";
    req.on("data", function (c) { d += c; });
    req.on("end", function () {
      try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); }
    });
  });
}

const server = http.createServer(async function (req, res) {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;

  // CORS（方便前端以 file:// 或其他端口调试时也能访问，同源时不产生副作用）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // 静态文件：首页与 seeyou.html
  if (req.method === "GET" && (p === "/" || p === "/seyou.html")) {
    fs.readFile(path.join(ROOT, "seeyou.html"), function (e, data) {
      if (e) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, {
        "Content-Type": MIME[".html"],
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache"
      });
      res.end(data);
    });
    return;
  }
  // 静态文件：已上传的图片（仅本地回退模式使用，云端走云存储 URL）
  if (req.method === "GET" && p.indexOf("/uploads/") === 0) {
    const name = path.basename(p);
    const fp = path.join(UPLOAD_DIR, name);
    if (fp.indexOf(UPLOAD_DIR) !== 0) { res.writeHead(403); res.end("forbidden"); return; }
    fs.readFile(fp, function (e, data) {
      if (e) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(fp)] || "application/octet-stream",
        "Cache-Control": "public, max-age=86400"
      });
      res.end(data);
    });
    return;
  }

  // PWA 静态资源（manifest / service worker / 图标）
  const PWA = {
    "/manifest.webmanifest": "application/manifest+json; charset=utf-8",
    "/sw.js": "text/javascript; charset=utf-8",
    "/icon-192.png": "image/png",
    "/icon-512.png": "image/png",
    "/apple-touch-icon.png": "image/png"
  };
  if (req.method === "GET" && PWA[p]) {
    const fp = path.join(ROOT, p.slice(1));
    fs.readFile(fp, function (e, data) {
      if (e) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, {
        "Content-Type": PWA[p],
        "Cache-Control": "public, max-age=86400"
      });
      res.end(data);
    });
    return;
  }

  if (p.indexOf("/api/") !== 0) { res.writeHead(404); res.end("not found"); return; }

  try {
    // 照片上传：POST /api/upload   { data: "data:image/jpeg;base64,...." } 或 raw 二进制
    if (req.method === "POST" && p === "/api/upload") {
      const ct = req.headers["content-type"] || "";
      const raw = ct.indexOf("application/json") !== -1 ? await readBody(req) : await readRaw(req);
      const img = parseImage(raw, ct);
      if (!img) return send(res, 400, { error: "无效的图片数据" });
      const fname = genId() + "." + img.ext;
      if (USE_TCB && tcbApp) {
        try {
          const cloudPath = "seeyou/uploads/" + fname;
          const up = await tcbApp.storage().uploadFile({ cloudPath: cloudPath, fileContent: img.buffer });
          return send(res, 200, { url: up.fileID });
        } catch (e) {
          return send(res, 500, { error: "云存储上传失败：" + (e && e.message) });
        }
      }
      ensureUploadDir();
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), img.buffer);
      return send(res, 200, { url: "/uploads/" + fname });
    }

    // 解析云端 cloud:// 文件 ID 为临时可访问 URL：GET /api/fileurl?f=cloud://...
    if (req.method === "GET" && p === "/api/fileurl") {
      const f = parsed.query.f;
      if (!USE_TCB || !tcbApp) return send(res, 400, { error: "非云端环境" });
      try {
        const r = await tcbApp.storage().getTempFileURL({ fileList: [f] });
        const item = (r && r.fileList && r.fileList[0]) || {};
        if (item.status === 0 && item.tempFileURL) return send(res, 200, { url: item.tempFileURL });
        return send(res, 404, { error: "文件不存在或无权访问" });
      } catch (e) { return send(res, 500, { error: String(e && e.message || e) }); }
    }

    // 创建关系：POST /api/relation   { nick, anniv }
    if (req.method === "POST" && p === "/api/relation") {
      const body = await readBody(req);
      const code = genCode();
      const rid = genId();
      const deviceId = genId();
      const rel = {
        id: rid, code: code, status: "pending",
        sideA: { deviceId: deviceId, nick: (body.nick || "我").trim() || "我", status: "miss" },
        sideB: null,
        anniversary: body.anniv || todayStr(),
        plans: [], photos: [], createdAt: Date.now()
      };
      db.relations[rid] = rel;
      saveDb(rid);
      return send(res, 200, { relationId: rid, code: code, deviceId: deviceId });
    }

    // 加入关系：POST /api/relation/join   { code, nick }
    if (req.method === "POST" && p === "/api/relation/join") {
      const body = await readBody(req);
      const code = String(body.code || "").trim();
      let found = null, rid = null;
      Object.keys(db.relations).forEach(function (k) {
        if (db.relations[k].code === code && db.relations[k].status === "pending") { found = db.relations[k]; rid = k; }
      });
      if (!found) return send(res, 404, { error: "配对码无效或已绑定" });
      if (found.sideB) return send(res, 409, { error: "该关系已有另一半" });
      const deviceId = genId();
      found.sideB = { deviceId: deviceId, nick: (body.nick || "TA").trim() || "TA", status: "miss" };
      found.status = "active";
      saveDb(rid);
      return send(res, 200, { relationId: rid, deviceId: deviceId });
    }

    // 匹配 /api/relation/:id 及后续子路径
    const m = p.match(/^\/api\/relation\/([^/]+)(\/sync)?$/);
    if (!m) { res.writeHead(404); res.end("not found"); return; }
    const rid = m[1];
    const rel = db.relations[rid];
    if (!rel) return send(res, 404, { error: "关系不存在" });

    // 拉取：GET /api/relation/:id
    if (req.method === "GET" && !m[2]) {
      const you = rel.sideA && rel.sideB
        ? (parsed.query.device === rel.sideA.deviceId ? "A" : (parsed.query.device === rel.sideB.deviceId ? "B" : null))
        : null;
      return send(res, 200, {
        id: rid, status: rel.status, anniversary: rel.anniversary,
        sideA: rel.sideA ? { nick: rel.sideA.nick, status: rel.sideA.status, wishlist: rel.sideA.wishlist || [] } : null,
        sideB: rel.sideB ? { nick: rel.sideB.nick, status: rel.sideB.status, wishlist: rel.sideB.wishlist || [] } : null,
        you: you,
        plans: rel.plans, photos: rel.photos
      });
    }

    // 同步：POST /api/relation/:id/sync   { deviceId, nick, status, anniversary, plans, photos }
    if (req.method === "POST" && m[2]) {
      const body = await readBody(req);
      const dev = body.deviceId;
      const side = rel.sideA && rel.sideA.deviceId === dev ? rel.sideA
        : (rel.sideB && rel.sideB.deviceId === dev ? rel.sideB : null);
      if (!side) return send(res, 403, { error: "设备未加入该关系" });
      if (body.nick != null) side.nick = String(body.nick).slice(0, 12);
      if (body.status != null) side.status = body.status;
      if (body.anniversary != null) rel.anniversary = body.anniversary;
      if (body.plans != null) rel.plans = mergeById(rel.plans, body.plans);
      if (body.photos != null) rel.photos = mergeById(rel.photos, body.photos);
      if (body.wishlist != null) side.wishlist = body.wishlist;
      saveDb(rid);
      return send(res, 200, { ok: true });
    }

    res.writeHead(405); res.end("method not allowed");
  } catch (e) {
    send(res, 500, { error: String(e && e.message || e) });
  }
});

// 先初始化存储并加载数据，再启动监听（防崩：即使 SDK/数据库异常也要保证端口起来）
try { initTcb(); } catch (e) { console.warn("[SeeYou] initTcb 异常(已忽略):", e && e.message); }
loadDb().then(function () {
  server.listen(PORT, function () {
    console.log("SeeYou 后端已启动： http://localhost:" + PORT);
    console.log("存储模式：" + (USE_TCB ? "CloudBase 云数据库 + 云存储(数据/照片持久)" : "本地 db.json + ./uploads"));
    console.log("用浏览器打开上面的地址，按提示创建/加入关系即可双人绑定。");
  });
}).catch(function (e) {
  // 即使 loadDb 失败也强制启动服务器（数据为空总比不服务好）
  console.warn("[SeeYou] loadDb 异常，以空数据启动：", e && e.message);
  db = { relations: {} };
  server.listen(PORT, function () {
    console.log("SeeYou 后端已启动（空数据模式）： http://localhost:" + PORT);
  });
});
