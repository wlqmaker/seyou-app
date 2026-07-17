// Vercel Serverless: GET /api/relation/:id & POST /api/relation/:id/sync
const DB_PREFIX = "seyou:";

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

// 内存回退
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
    memDb = db;
  }
}

function mergeById(arr, inc) {
  if (!inc) inc = [];
  const map = {};
  (arr || []).forEach((x) => {
    if (x && x.id) map[x.id] = x;
  });
  inc.forEach((x) => {
    if (x && x.id) map[x.id] = x;
  });
  return Object.keys(map).map((k) => map[k]);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const rid = req.query?.id;
  if (!rid) {
    return res.status(400).json({ error: "missing relation id" });
  }

  try {
    const db = await loadDb();
    const rel = (db.relations || {})[rid];
    if (!rel) {
      return res.status(404).json({ error: "关系不存在" });
    }

    // GET /api/relation/:id — 拉取关系数据
    if (req.method === "GET") {
      const device = req.query?.device;
      const you =
        rel.sideA && rel.sideB
          ? device === rel.sideA.deviceId
            ? "A"
            : device === rel.sideB.deviceId
              ? "B"
              : null
          : null;

      return res.status(200).json({
        id: rid,
        status: rel.status,
        anniversary: rel.anniversary,
        sideA: rel.sideA
          ? {
              nick: rel.sideA.nick,
              status: rel.sideA.status,
              wishlist: rel.sideA.wishlist || [],
            }
          : null,
        sideB: rel.sideB
          ? {
              nick: rel.sideB.nick,
              status: rel.sideB.status,
              wishlist: rel.sideB.wishlist || [],
            }
          : null,
        you: you,
        plans: rel.plans || [],
        photos: rel.photos || [],
      });
    }

    // POST /api/relation/:id — 同步数据（兼容前端直接 POST 到 id）
    if (req.method === "POST") {
      const body = req.body || {};
      const dev = body.deviceId;
      const side =
        rel.sideA && rel.sideA.deviceId === dev
          ? rel.sideA
          : rel.sideB && rel.sideB.deviceId === dev
            ? rel.sideB
            : null;

      if (!side) {
        return res.status(403).json({ error: "设备未加入该关系" });
      }

      if (body.nick != null) side.nick = String(body.nick).slice(0, 12);
      if (body.status != null) side.status = body.status;
      if (body.anniversary != null) rel.anniversary = body.anniversary;
      if (body.plans != null) rel.plans = mergeById(rel.plans, body.plans);
      if (body.photos != null) rel.photos = mergeById(rel.photos, body.photos);
      if (body.wishlist != null) side.wishlist = body.wishlist;

      await saveDb(db);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    console.error("[relation/id] error:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
