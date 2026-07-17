// Vercel Serverless: POST /api/upload
// 接收 base64 图片，存入 Vercel Blob，返回可访问 URL
import { put } from "@vercel/blob";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const body = req.body;
    let dataUrl = "";

    if (typeof body === "object" && body.data) {
      dataUrl = body.data;
    } else if (typeof body === "string" && body.startsWith("data:")) {
      dataUrl = body;
    } else {
      return res.status(400).json({ error: "无效的图片数据，需要 { data: 'data:image/...;base64,...' }" });
    }

    // 解析 base64 data URL → buffer
    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "无法解析图片数据格式" });
    }

    const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
    const buffer = Buffer.from(matches[2], "base64");
    const filename = `seeyou/photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // 上传到 Vercel Blob（公开访问）
    const blob = await put(filename, buffer, {
      access: "public",
      contentType: `image/${ext}`,
    });

    return res.status(200).json({ url: blob.url });
  } catch (e) {
    console.error("[upload] error:", e);
    return res.status(500).json({ error: "上传失败：" + (e.message || String(e)) });
  }
}
