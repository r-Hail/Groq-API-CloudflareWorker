
# Groq API Cloudflare Worker 转发代理 — 项目说明

> 项目文件：
> - `groq-proxy.mjs` —— 单 Key 版（简单，客户端传什么 Key 就用什么 Key）
> - `groq-proxy-multi.mjs` —— **多 Key 轮询版**（推荐，见第六节）
>
> 两个版本二选一部署即可。本文档可用于公开分享，不含个人配置信息

---

## 一、这个项目是干什么的

一句话：**把 Groq 的 AI API 通过 Cloudflare Worker 做一层转发，让任何支持 OpenAI 格式自定义端点的客户端都能使用 Groq 的免费高速模型。**

### 适用场景

Groq https://groq.com 

是响应速度极快的免费 AI 推理平台之一（自研 LPU 芯片），这个项目解决两个常见问题：

| 问题 | 本项目如何解决 |
|------|----------------|
| 客户端所在网络环境无法直接访问 `api.groq.com` | Worker 部署在 Cloudflare 全球节点上，由它替你调用 Groq |
| 部分客户端不支持配置 Groq 端点 | Groq 本身就是标准 OpenAI 格式，Worker 纯转发即可，**无协议转换、无 schema 校验问题** |

### 工作原理

```
你的客户端（任何 OpenAI 格式工具）
    │  请求 https://你的workers地址/v1/chat/completions
    ▼
Cloudflare Worker（纯转发）
    │  改写路径: /v1/xxx  →  /openai/v1/xxx
    │  透传 Authorization 头（你的 Groq Key）
    ▼
api.groq.com/openai/v1/xxx
    │  Groq 处理（LPU 推理，流式返回）
    ▼
响应原路返回（支持流式 SSE，已剥离压缩头防止解析错误）
```

**关键点：Worker 只做"路径改写 + 头部清理"，不改请求体、不校验响应体。** 所以：

- 工具调用（function calling）、流式输出、多模态全部原样透传
- Groq 升级 API 不需要更新这个 Worker

---

## 二、路径改写规则

Groq 的 OpenAI 兼容端点前缀是 `/openai/v1`，Worker 自动映射：

| 你请求（Worker 地址） | 实际转发到 Groq |
|------------------------|-----------------|
| `GET /v1/models` | `api.groq.com/openai/v1/models` |
| `POST /v1/chat/completions` | `api.groq.com/openai/v1/chat/completions` |
| `POST /v1/completions` | `api.groq.com/openai/v1/completions` |
| `GET /`（根路径） | 返回一行提示文字（用来快速验证 Worker 存活）|

其余路径（如 `/openai/v1/xxx` 直接写法）也支持，会原样转发。

---

## 三、部署步骤（约 5 分钟）

1. 打开 **https://workers.cloudflare.com/playground**
2. **清空**编辑器里的默认代码
3. 打开 `groq-proxy.mjs`，**全选复制 → 粘贴**进编辑器
4. 点右上角 **Deploy**
5. 记下生成的地址，形如 `https://groq-proxy-xxxx.xxxxx.workers.dev`

### 可选：绑定自定义子域名

如果默认的 workers.dev 地址在你的网络环境下不可达，可以绑定自己的域名：

- Cloudflare 后台 → Workers & Pages → 这个 Worker → **Settings → Domains & Routes → Add → Custom Domain**
- 填一个你已有域名下的子域名（如 `groq.你的域名.com`）→ 几分钟生效

### 部署验证

浏览器打开 `https://你的地址/`，看到：

```
Groq proxy OK. Use base URL: https://你的地址/v1
```

即部署成功（这行字是 Worker 自己返回的，不经过 Groq）。

---

## 四、获取 Groq API Key

1. 打开 **https://console.groq.com/keys**
2. 注册/登录（支持 Google 账号）
3. **Create API Key** → 复制（`gsk_` 开头，如 `gsk_AbC123...`）

> ⚠️ **注意**：需要使用能正常访问 Groq 网站的网络环境完成注册。Worker 转发只负责 **API 调用**环节。
>
> Groq 免费层无需信用卡。

---

## 五、客户端配置

在任何支持自定义 OpenAI 端点的客户端里（以通用配置为例）：

| 配置项 | 填什么 |
|--------|--------|
| **Base URL** | `https://你的地址/v1`（绑了自定义域名就填自定义域名的）|
| **API Key** | `gsk_` 开头的 Groq Key |
| **API 类型** | `openai-completions`（Chat Completions 格式，**不要选 openai-responses**）|

其他软件如果用环境变量：

```
OPENAI_BASE_URL = https://你的地址/v1
OPENAI_API_KEY  = gsk_你的Key
```

---

## 六、多 Key 版本用法（groq-proxy-multi.mjs）

多 Key 版在单 Key 版的基础上增加了 **Key 池轮询** 和 **失败自动换 Key**，适合有多个 Groq 账号、想分摊免费额度的场景。

### 两种填 Key 的方式（二选一）

**方式 A：写进代码里**（最简单，Playground 部署推荐）

打开 `groq-proxy-multi.mjs`，找到顶部配置区，去掉注释、填入你的 Key：

```js
const GROQ_KEYS = [
  "gsk_你的第1个Key",
  "gsk_你的第2个Key",
  "gsk_你的第3个Key",
];
```

**方式 B：用环境变量**（Key 不进代码，更安全，适合公开分享代码）

1. Cloudflare 后台 → Workers & Pages → 这个 Worker → **Settings → Variables and Secrets**
2. 添加变量：名称 `GROQ_API_KEYS`，值填逗号分隔的多个 Key：

```
gsk_你的第1个Key,gsk_你的第2个Key,gsk_你的第3个Key
```

> ⚠️ 环境变量优先级高于代码内配置；两种方式都没配时，回退为"客户端传什么 Key 就用什么"的单 Key 模式。

### 轮询行为

| 规则 | 说明 |
|------|------|
| **轮询分摊** | 多个 Key 按 round-robin 轮流使用，每次请求换一个，额度均匀分摊 |
| **自动重试** | 请求遇到 **429（限额）/ 401 / 403** 时，自动换下一个 Key 重试（默认最多重试 3 次，由代码顶部 `MAX_RETRIES` 控制）|
| **客户端 Key 优先** | 客户端填了 `gsk_` 开头的真 Key 时，直接用客户端的（不消耗池）；客户端随便填（如 `pool`）时，走 Key 池 |
| **可观测** | 健康检查（根路径）会显示池内 Key 数量；发生重试时响应头 `X-Proxy-Key-Slot` 标明最终用了第几个 Key（不泄露 Key 本身）|

### 部署与验证

部署步骤和单 Key 版完全相同（见第三节）。部署后浏览器打开根路径验证：

```
Groq proxy (multi-key) OK. Keys loaded: 3. Use base URL: https://你的地址/v1
```

`Keys loaded` 数量正确即 Key 池配置成功。

### 已知限制

- 轮询游标保存在 Worker 实例内存中，实例重启后从头开始——对"均匀分摊额度"影响可忽略
- 跨实例（Cloudflare 多节点同时服务）游标不共享，极端情况下短时间可能重复用到同一个 Key；单人使用场景基本感知不到
- 需要严格的按 Key 计量/持久化状态时，可自行加 KV 存储（本版本刻意保持零依赖）

---

## 七、Groq 免费层主流模型

| 模型 ID | 说明 | 适合 |
|---------|------|------|
| `llama-3.3-70b-versatile` | Meta 70B 旗舰 | ⭐ 通用对话/推理主力 |
| `llama-3.1-8b-instant` | 8B 极速 | ⭐ 最快，简单任务 |
| `openai/gpt-oss-120b` | OpenAI 开源 120B | ⭐ 质量好 |
| `openai/gpt-oss-20b` | OpenAI 开源 20B | 快 + 质量均衡 |
| `qwen/qwen3-32b` | 通义千问 32B | 中文友好 |
| `moonshotai/kimi-k2-instruct` | Kimi K2 | 长文本/中文 |
| `gemma2-9b-it` | Google Gemma 2 9B | 轻量 |

> 模型列表会随 Groq 上新/下架而变化。**查看当前完整列表**：打开 `https://你的地址/v1/models`（带 `Authorization: Bearer gsk_你的Key` 头）。

### 免费额度（Rate Limits）

- 免费层按天给请求额度（各模型不同，通常 **14,400 请求/天** 量级）
- RPM（每分钟请求数）按模型从 30 到 6,000 不等
- 单人日常聊天完全够用；跑批量脚本容易触顶（返回 429，等一分钟即恢复）

---

## 八、故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 浏览器开根路径显示 `Groq proxy OK` | ✅ Worker 正常 | — |
| 浏览器开 `/v1/models` 返回 401 | ✅ 链路正常，只是没带 Key | 正常现象，在客户端里带 Key 用 |
| 客户端报 401 | Key 错/过期 | 去 console.groq.com 重新生成 |
| 客户端报 403 `Forbidden` | Worker 所在节点被 Groq 拒（较少见）| 重新部署一次，或改用其他转发平台（如 Deno Deploy）|
| 客户端报 429 | 超出 Groq 免费额度 | 等 1 分钟（RPM）或次日（日额度），换 `llama-3.1-8b-instant` 限额更高 |
| 客户端报 404 | Base URL 少了 `/v1` 或 API 类型选错 | 确认填 `https://地址/v1`，API 类型为 `openai-completions` |
| 连接超时/Connection error | workers.dev 地址在当前网络不可达 | 绑自定义域名（见第三节）|
| 模型名报错 `model_not_found` | 模型下架或名字写错 | 重新拉 `/v1/models` 列表核对 |

---

## 九、源码结构

### groq-proxy.mjs（单 Key 版）

```
CORS 常量            —— 跨域响应头（浏览器直连场景用）
export default fetch —— Worker 入口
  ├─ OPTIONS 预检    → 直接返回 204
  ├─ 根路径 /        → 返回 "Groq proxy OK" 提示
  ├─ 路径改写        → /v1/xxx → /openai/v1/xxx
  ├─ 请求头清理       → 删除 host/cf-* /x-forwarded-* 等本机头（防止干扰上游）
  │                    并设置浏览器 User-Agent（部分 API 对缺失 UA 直接 403）
  ├─ fetch 转发      → 原样转发 method + headers + body（流式 duplex: half）
  └─ 响应处理        → 透传状态码和响应体，补 CORS，删 content-encoding/
                       content-length/transfer-encoding（body 已被 Workers
                       解码，保留会触发客户端 "incorrect header check" 报错）
```

### groq-proxy-multi.mjs（多 Key 版）在单 Key 版基础上增加

```
GROQ_KEYS 常量       —— 代码内 Key 池（环境变量 GROQ_API_KEYS 优先）
loadPool()           —— 读取并过滤 Key 池（只保留 gsk_ 开头的有效项）
rr 轮询游标           —— 实例内存中的 round-robin 计数
Key 序列决策          → 客户端带 gsk_ 真 Key：直连（不消耗池）
                       → 否则池非空：从游标取最多 MAX_RETRIES+1 个 Key 依次尝试
                       → 都没有：原样透传（Groq 返回 401 提示）
请求体缓冲            → await request.text()，供重试复用
重试循环              → 429/401/403 自动换下一个 Key；响应头
                       X-Proxy-Key-Slot 标明最终用的 Key 序号
```

---

## 十、与其他转发方案的对比

| | openai-gemini 类代理 | groq-proxy（本项目）|
|---|---|---|
| 上游 | Google Gemini | Groq |
| Worker 职责 | 协议转换 + schema 清洗 + 签名回传（复杂）| 纯转发（极简，几乎不会坏）|
| Key 格式 | Google AI Studio Key | `gsk_` 开头 |
| 优势 | Gemini 系列质量好 | **速度极快**、OpenAI 原生格式零兼容问题 |
| 建议用途 | 复杂任务 | 日常快速问答 |

排查任何 API 转发问题的通用顺序：**网络连通性 → Key 有效性 → API 类型 → 模型可用性**，按这个顺序查就不会迷路。
