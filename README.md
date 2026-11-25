# Cloudflare WARP 配置生成器（Warp-Masque free）

用 **GitHub Actions** 在服务端注册 Cloudflare WARP 设备并生成 Mihomo/Clash 的 MASQUE 订阅；站点本身是纯静态 GitHub Pages，不需要 Cloudflare Worker，也不需要自己的服务器。

在线站点：<https://looomix.github.io/Warp-Masque-free/>
仓库：<https://github.com/looomix/Warp-Masque-free>

## 使用方式

### 云端一键生成（推荐）

1. 打开 [Actions 工作流](https://github.com/looomix/Warp-Masque-free/actions/workflows/generate-warp.yml)。
2. 点击 **Run workflow**，可选择设备名、`commit` 和 artifact 保留天数。**`commit` 默认关闭**；只有显式开启时才会把含私钥的配置提交到仓库。
3. 工作流会：
   - 带重试地下载 `usque` 并注册一台 WARP/MASQUE 设备；
   - 运行 `scripts/generate.py` 生成 16 个精选 MASQUE 节点；
   - 用 `scripts/validate.py` 校验 YAML 结构、字段与唯一性；
   - 上传 `warp-masque.yaml`、`warp-masque-shadowrocket.txt` 和原始 `usque-config.json` 作为 artifact；
   - 仅在 `commit=true` 时把配置提交回仓库，触发 Pages 更新。
4. 订阅地址请在站点页面查看：<https://looomix.github.io/Warp-Masque-free/>

页面打开时会自动读取已发布的账号 JSON 与订阅 YAML；点击“刷新订阅内容”可绕过缓存重新读取。另有 `Pages 健康检查` 工作流每 6 小时检测站点，发现 404 时尝试自动恢复。

> 需要 **mihomo Alpha** 内核（稳定版不支持 `type: masque`）。

### 本地转换

把 usque 生成的账号 JSON 粘贴到网页输入框，点击“从账号 JSON 生成输出”，可在本地得到 Clash YAML 与（当账号含 X25519 私钥时）WireGuard/AWG `.conf`。本地转换不上传任何数据。

## 隐私提醒

公开仓库里的 `configs/warp-masque.yaml`、`configs/usque-config.json` 和 artifact 都**包含私钥**，等同于账号凭据。任何拿到订阅链接的人都能使用该 WARP 账号。工作流默认只上传 artifact，不提交私钥；如必须公开订阅，请开启 `commit` 并自行承担风险，同时定期在 WARP 后台吊销旧设备。生成的配置已关闭 `allow-lan` 并把端口绑定到本地。

不要高频运行工作流，Cloudflare 会风控 WARP 设备注册。若 Token 权限允许，可为 `Pages 健康检查` 配置 `PAGES_TOKEN` secret，以便自动恢复 Pages。

## 目录

```text
index.html                     静态页面
assets/style.css               样式
assets/app.js                  本地账号转换与输出
assets/template.js             Clash YAML 模板
scripts/generate.py            usque config.json -> Clash YAML
scripts/validate.py            订阅结构校验
.github/workflows/generate-warp.yml  配置生成工作流
.github/workflows/pages-health.yml   Pages 健康检查与恢复
configs/warp-masque.yaml       工作流生成的订阅（含私钥）
configs/usque-config.json      工作流生成的原始账号（页面自动载入）
LICENSE / NOTICE               许可与出处
.nojekyll                      GitHub Pages 标记
```

## 致谢与许可

本项目为独立实现，采用 AGPL-3.0 许可。非官方项目，与 Cloudflare、Amnezia 无关联。使用 WARP 请遵守 Cloudflare 条款与所在地区法律。
