// Vercel Serverless: POST /api/relation & POST /api/relation/join
// 数据存储：优先 Vercel KV，无则内存模式（重启丢失）
const DB_PREFIX = "seyou:";

// 延迟加载 KV（避免未配置时报错）
let _kv = null;
async function getKV() {
  if (_kv !== null) return _kv;
  try {
    const mod = await import("@vercel/kv");
    _kv = mod.default || mod;
    return _kv;
  } catch (e) {
    _kv = false;
    return null;
  }
}

// ===== 内存回退存储 =====
let memDb = { relations: {} };

async function loadDb() {
  const kv = await getKV();
  if (!kv) return memDb;

  try {
    const raw = await kv.get(DB_PREFIX + "db");
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("[loadDb] kv error:", e.message);
  }
  return { relations: {} };
}

async function saveDb(db) {
  const kv = await getKV();
  if (!kv) { memDb = db; return; }

  try {
    await kv.set(DB_PREFIX + "db", JSON.stringify(db));
  } catch (e) {
    console.error("[saveDb] kv error:", e.message);
    // 回退到内存
    memDb = db;
  }
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const url = new URL(req.url || "", "http://localhost");
  const path = url.pathname;

  try {
    const db = await loadDb();

    // POST /api/relation — 创建关系
    if (path === "/api/relation") {
      const body = req.body || {};
      const code = genCode();
      const rid = genId();
      const deviceId = genId();
      const rel = {
        id: rid,
        code: code,
        status: "pending",
        sideA: {
          deviceId: deviceId,
          nick: (body.nick || "我").trim() || "我",
          status: "miss",
        },
        sideB: null,
        anniversary: body.anniv || todayStr(),
        plans: [],
        photos: [],
        createdAt: Date.now(),
      };
      db.relations[rid] = rel;
      await saveDb(db);
      return res.status(200).json({
        relationId: rid,
        code: code,
        deviceId: deviceId,
      });
    }

    // POST /api/relation/join — 加入关系
    if (path === "/api/relation/join") {
      const body = req.body || {};
      const code = String(body.code || "").trim();
      let found = null,
        rid = null;
      for (const [k, v] of Object.entries(db.relations || {})) {
        if (v.code === code && v.status === "pending") {
          found = v;
          rid = k;
          break;
        }
      }
      if (!found)
        return res.status(404).json({ error: "配对码无效或已绑定" });
      if (found.sideB)
        return res.status(409).json({ error: "该关系已有另一半" });

      const deviceId = genId();
      found.sideB = {
        deviceId: deviceId,
        nick: (body.nick || "TA").trim() || "TA",
        status: "miss",
      };
      found.status = "active";
      await saveDb(db);
      return res.status(200).json({
        relationId: rid,
        deviceId: deviceId,
      });
    }

    return res.status(404).json({ error: "not found" });
  } catch (e) {
    console.error("[relation] error:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
