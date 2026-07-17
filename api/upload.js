// Vercel Serverless: POST /api/upload
// 接收 base64 图片，返回 data URL（内嵌存储，零依赖）
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const body = req.body || {};
    let dataUrl = "";

    if (typeof body === "object" && body.data) {
      dataUrl = body.data;
    } else if (typeof body === "string") {
      dataUrl = body;
    }

    if (!dataUrl || !dataUrl.startsWith("data:image")) {
      return res.status(400).json({ error: "无效图片数据" });
    }

    // 验证格式并压缩（限制 2MB）
    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "无法解析图片格式" });
    }

    const b64 = matches[2];
    if (b64.length > 2 * 1024 * 1024) {
      return res.status(413).json({ error: "图片过大，请控制在 2MB 以内" });
    }

    // 直接返回 data URL，由 sync 接口存入关系数据
    return res.status(200).json({
      url: dataUrl,
      inline: true,
      size: b64.length,
    });
  } catch (e) {
    console.error("[upload] error:", e);
    return res.status(500).json({ error: "上传失败：" + (e.message || String(e)) });
  }
}
