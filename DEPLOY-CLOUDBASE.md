# SeeYou App —— 部署到腾讯云 CloudBase（国内快、数据持久）

本 App 是零依赖的 Node 原生后端 + 单文件前端。已改造为**双存储模式**：

- **检测到 CloudBase 环境**（`TCB_ENV` 已配置）→ 关系数据写入**云数据库**，照片写入**云存储**，重启/重部署都不丢。
- **本地/普通服务器**（无 TCB_ENV）→ 自动回退：数据写 `db.json`，照片写 `./uploads/`。

前端 `seeyou.html` 一行未改，会自动用 URL 渲染照片，兼容旧的 base64 数据。

---

## 一、准备（控制台一次搞定）

1. 进入 [CloudBase 控制台](https://console.cloud.tencent.com/tcb)，**开通环境**（记下「环境 ID」，形如 `seeyou-1a2b3c`）。
2. **云数据库**：新建集合 `seeyou_relations`（权限设为「所有用户可读写」或「仅创建者可读写」均可，App 用服务端 SDK 写，权限宽松不影响）。
3. **云存储**：无需预建目录，代码会自动上传到 `seeyou/uploads/`。建议确认存储桶「权限设置」里允许**临时访问链接**（默认开启），否则 `/api/fileurl` 无法解析。
4. **云托管**：进入「云托管」→ 新建**服务**，服务名随意（如 `seyou`）。

---

## 二、部署后端（二选一）

### 方式 A：连代码仓库（推荐，便于后续更新）
1. 把本目录（`app/`）推到 Gitee 或 GitHub（`.gitignore` 已排除 `db.json`、`uploads/`、`node_modules/`）。
2. 云托管服务里「新建版本」→ 选择「代码仓库」→ 授权并选中仓库。
3. 配置：
   - **监听端口**：`3000`
   - **构建命令**：`npm install`（装 `@cloudbase/node-sdk`）
   - **启动命令**：`node server.js`
   - **环境变量**：`TCB_ENV=你的环境ID`
4. 点击部署，等状态变「正常」，记下分配的**公网域名**（如 `https://seyou-xxx.ap-shanghai.app.tcloudbase.com`）。

### 方式 B：直接上传文件夹
1. 云托管服务「新建版本」→「本地代码」→ 选择本 `app/` 文件夹打包上传。
2. 端口 / 构建 / 启动 / 环境变量同上。
3. 部署。

---

## 三、配置环境变量（关键）

在云托管版本的「环境变量」里至少加：

| 变量名 | 值 | 说明 |
|--------|----|------|
| `TCB_ENV` | 你的环境 ID（如 `seyou-1a2b3c`） | **触发云模式**，缺失则回退本地文件 |
| `PORT` | `3000` | 云托管会注入，可不填 |

> 云托管环境内，`@cloudbase/node-sdk` 可通过环境凭证**免密**初始化，无需 `secretId/secretKey`。

---

## 四、验证（上线后必做）

打开云托管域名（如 `https://seyou-xxx...`），按页面创建关系 → 进入后**上传一张照片** → 检查：

1. 前端能正常显示刚上传的照片（云端走 `/api/fileurl` 解析 `cloud://`）。
2. 云数据库 `seeyou_relations` 集合里出现了该关系文档，且 `photos` 字段是 `[{id, url:"cloud://...", addedAt}]`（**不再是 base64**）。
3. 云存储 `seeyou/uploads/` 目录下出现了对应图片文件。

也可用命令行快速验：

```bash
# 上传一张测试图，确认返回 cloud:// 链接
curl -X POST https://你的域名/api/upload \
  -H "Content-Type: application/json" \
  -d '{"data":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"}'
# 期望返回 {"url":"cloud://seyou-xxx/seeyou/uploads/xxxx.png"}
```

---

## 五、关于照片存储（已迁移）

| 项 | 改造前 | 改造后 |
|----|--------|--------|
| 存储位置 | base64 直接塞进数据库文档 | 云端：`seeyou/uploads/`（云存储）；本地：`./uploads/` |
| 数据库存什么 | 整段 base64（占十几 KB~MB） | 仅存 URL（`cloud://...` 或 `/uploads/...`） |
| 单文档上限影响 | 照片多了顶到 16MB 上限 | 不受限，文档很小 |

- 本地模式：上传文件落 `./uploads/`，通过 `/uploads/文件名` 静态访问。
- 云端模式：上传走 `tcbApp.storage().uploadFile`，返回 `fileID`（即 `cloud://...`），前端用 `/api/fileurl?f=cloud://...` 换临时 URL 显示。

---

## 六、旧数据迁移（如果你之前用过本地 base64 版）

如果旧 `db.json` 里已有 `photos:[{id, data:"data:image/..."}]`：

- 这些数据**不会自动**转成云存储文件。
- 前端会尝试用 `ph.url || ph.data` 渲染——`data:` 仍可直接显示，所以**旧照片在本地打开还能看**，但上了 CloudBase 后旧 base64 不会被同步到云端。
- 建议：上线后在两台手机上重新上传一次重要照片，旧 base64 数据可随后丢弃。

---

## 七、停机/重启注意事项

- **数据**：云数据库持久，重启不丢。
- **照片（云端）**：云存储持久，重启不丢。
- **照片（本地回退模式）**：`./uploads/` 在云托管临时文件系统里会随重启清空——所以**长期用务必走 CloudBase 云存储**（即配好 `TCB_ENV`）。

---

## 八、成本参考（2026）

- CloudBase 有**免费额度**（环境 + 一定量的数据库读写/存储流量）。
- 两三人自用、低频访问，基本在免费额度内。
- 超出后按量计费，情侣双人量级费用极低。
