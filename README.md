# MASQUE To Clash

把 Cloudflare WARP **MASQUE** 账号转换成 Clash / Mihomo（Clash.Meta）`YAML` 配置的纯前端工具，参考 [m2c.pages.dev](https://m2c.pages.dev/) 的选项与配置结构实现。

在线地址：<https://looomix.github.io/MASQUE-To-Clash/>

## 功能

- 一键注册并生成（调用可配置的注册接口），失败时自动提示粘贴原站账号 JSON。
- 支持 H3 / H2 / H3-L4、IPv4 / IPv6 / 全部端点、固定或随机端口（500/4500/8095/443）。
- 生成 `type: masque` 节点，包含私钥、公钥、IP、MTU、UDP、SNI、拥塞控制等字段。
- 内置 DNS / Fake-IP、策略组（自动端点、手动端点、故障转移、负载均衡、国内直连）与规则提供器。
- 下载 YAML、复制 YAML、生成**本地订阅链接**（`#sub=` base64url 编码，打开本页即可恢复）。
- 可选订阅托管 API：填写实现了 `/api/sub` 契约的 Worker 后，可生成真正的远程订阅地址。

## 订阅链接说明

- **本地订阅链接**：`https://looomix.github.io/MASQUE-To-Clash/#sub=<base64url>`。它把 YAML 编码在 URL 片段里，打开后页面自动解码并显示。方便备份与分享，但不能被 Clash 直接当作远程订阅拉取。
- **远程订阅地址**：在页面填入订阅托管 API 基址（如 `https://your-worker.workers.dev`），页面会 `POST /api/sub`，请求体为 `{format:"clash", content:<yaml>, tier:"24h"}`，期望返回 `{url:"..."}`。兼容 `usque-custom-pro` 的订阅接口约定。
- 两种链接都包含私钥，请当作凭据对待。

## 一键注册的已知限制

原站使用的注册服务 `usque-register-server.pages.dev` 有来源域名白名单，`github.io` 不在其中，因此默认的一键注册通常会被拒绝。处理方式：

1. 在 [m2c.pages.dev](https://m2c.pages.dev/) 使用其“一键生成”取得账号 JSON；
2. 把 JSON 粘贴到本页“MASQUE 账号”输入框，再点击“生成 YAML 与订阅链接”；
3. 或者部署一个自己的兼容 Worker，并把地址填入“注册接口”。

转换本身完全在浏览器本地完成，不需要服务器。

## 本地预览

```bash
python -m http.server 8000
# 打开 http://localhost:8000/
```

## 目录

```text
index.html          页面结构
assets/style.css    样式
assets/app.js       账号解析、节点/YAML 生成、订阅链接编码
assets/template.js  YAML 模板
LICENSE             AGPL-3.0
NOTICE              出处说明
.nojekyll           GitHub Pages 标记
```

## 致谢与许可

配置结构与选项参考 [m2c.pages.dev](https://m2c.pages.dev/) 及 [MASQUE 导航](https://masque.pages.dev/)，本项目为独立实现，保留 AGPL-3.0 许可。非官方项目，与 Cloudflare、Amnezia 及上述站点作者无关联。使用 MASQUE / WARP 请遵守 Cloudflare 服务条款与所在地区法律。
