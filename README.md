# Cloudflare WARP 配置生成器（MASQUE To Clash）

一键注册 Cloudflare WARP，并在浏览器里生成：

- **WireGuard / AmneziaWG `.conf`**（AWG 1.5 / 2.0 / 3.0 / 3.1 混淆档位）
- **MASQUE 的 Clash / Mihomo YAML**
- **可直接导入的订阅链接**

在线站点：<https://looomix.github.io/MASQUE-To-Clash/>
仓库：<https://github.com/looomix/MASQUE-To-Clash>

## 为什么需要 Worker

Cloudflare 的 WARP 注册接口不允许浏览器直接跨域调用，原站 `m2c.pages.dev` 同样依赖服务端。本仓库内置了一个免费 Cloudflare Worker 中继，负责把请求转发到 `api.cloudflareclient.com`，并附带无存储的订阅端点。

### 部署中继（一次即可）

1. 打开仓库页面的 “Deploy to Cloudflare Workers” 按钮：  
   <https://deploy.workers.cloudflare.com/?url=https://github.com/looomix/MASQUE-To-Clash>
2. 授权 Cloudflare，保持默认配置并部署。
3. 复制 Worker 地址（形如 `https://xxx.workers.dev`）填入网页的“Worker 地址”。
4. 点击“检查连接”，然后“一键注册 WARP 并生成”。

手动部署：

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler deploy ../wrangler.jsonc
```

## Worker 接口

| 路径 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `POST /api/warp/register` | 注册 X25519 WARP 设备 |
| `POST /api/warp/enroll` | 为设备登记 P-256 MASQUE 公钥 |
| `POST /api/sub` | 把 YAML 编码成无状态订阅令牌并返回 URL |
| `GET /sub/<token>` | 返回 YAML，Clash 可直接作为远程订阅拉取 |

订阅端点不保存任何内容：令牌本身就是 base64url 编码的 YAML，因此链接包含私钥，请当作凭据保管。Worker 对所有来源开放 CORS，便于静态站点调用；请自行评估是否限制到你的域名。

## 生成流程

1. 浏览器用 Web Crypto 生成 X25519 密钥（WireGuard）和 P-256 密钥（MASQUE）。
2. 通过 Worker 向 Cloudflare 注册两台设备：一台输出 WireGuard 配置，一台登记 MASQUE 公钥。
3. 本地组装 `.conf`（含 AWG 混淆参数）与 Clash YAML（策略组、Fake-IP、规则提供器）。
4. 通过 Worker 生成订阅地址；Worker 不可用时退化为本地 `#sub=` 链接。

## 无 Worker 的用法

如果暂时不部署 Worker，可在 `m2c.pages.dev` 或 `wgcf` 获取账号 JSON，粘贴到网页的“账号 JSON”框，点击“重新生成输出”。转换仍然完全本地完成，但无法注册新设备或生成远程订阅。

## 本地预览

```bash
python -m http.server 8000
# 打开 http://localhost:8000/
```

## 目录

```text
index.html              页面
assets/style.css        样式
assets/app.js           密钥生成、配置组装、订阅链接
assets/template.js      Clash YAML 模板
worker/index.js         Cloudflare Worker 中继 + 订阅端点
wrangler.jsonc          Worker 部署配置
LICENSE / NOTICE        许可与出处
.nojekyll               GitHub Pages 标记
```

## 致谢与许可

配置结构与选项参考 [m2c.pages.dev](https://m2c.pages.dev/)、[MASQUE 导航](https://masque.pages.dev/) 与 [usque-custom-pro](https://github.com/KJGX66F/usque-custom-pro)，本项目为独立实现，AGPL-3.0。非官方项目，与 Cloudflare、Amnezia 及上述站点作者无关联。使用 WARP 请遵守 Cloudflare 条款与所在地区法律。
