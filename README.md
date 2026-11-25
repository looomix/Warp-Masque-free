# Cloudflare WARP 配置生成器（Warp-Masque free）

用 **GitHub Actions** 在服务端注册 Cloudflare WARP 设备，测速优选端点后生成 Mihomo/Clash、sing-box、WireGuard 等多客户端配置；站点本身是纯静态 GitHub Pages，不需要 Cloudflare Worker，也不需要自己的服务器。

在线站点：<https://looomix.github.io/Warp-Masque-free/>
仓库：<https://github.com/looomix/Warp-Masque-free>

## 功能一览

| 能力 | 说明 |
| --- | --- |
| 云端一键生成 | Runner 内运行 `usque` 注册设备，无需本地环境 |
| 测速与自动优选 | 并发探测 4 个官方端点 × 4 个端口，剔除不可达端点、按延迟排序后写入订阅 |
| 版本管理与回滚 | 每次生成保留最近 N 份带时间戳快照（`configs/history/`），页面可查看/下载，并用 `rollback.yml` 一键回滚 |
| 多客户端导出 | Clash/Mihomo YAML、sing-box JSON、标准 WireGuard `.conf`、`masque://` 分享链接 |
| 连通性自检 | Runner 侧测速报告 + 浏览器实际试探，失败给出端口 / SNI / 内核版本排查提示 |
| 定时自动更新 | 每 6 小时自动重新注册并发布，页面显示上次生成 / 下次更新与倒计时 |
| 一键清空（持久） | 清空账号 JSON 与三条订阅地址，并记住该操作，下次打开页面保持空白 |

## 使用方式

### 云端一键生成（推荐）

1. 打开 [Actions 工作流](https://github.com/looomix/Warp-Masque-free/actions/workflows/generate-warp.yml)。
2. 点击 **Run workflow**，可设置设备名、是否测速、延迟阈值、快照数量、`commit` 与 artifact 保留天数。
   **`commit` 默认关闭**；只有显式开启（或由定时任务触发）时才会把含私钥的配置提交到仓库。
3. 工作流会：
   - 带重试地下载 `usque` 并注册一台 WARP/MASQUE 设备；
   - 测速端点并按延迟排序，剔除不可达/超阈值的端点；
   - 运行 `scripts/generate.py` 生成订阅、多格式配置、`health.json`、`meta.json` 与历史快照；
   - 用 `scripts/validate.py` 校验 YAML 结构与字段；
   - 上传 `dist/` 作为 artifact，并按需提交回仓库触发 Pages 更新。
4. 订阅地址在站点页面查看：<https://looomix.github.io/Warp-Masque-free/>

**定时任务**：工作流内置 `cron: 0 */6 * * *`（UTC，北京时间 02/08/14/20 点），会以 `commit=true` 自动发布，无需手动点击。

### 关于“清空”行为

- 页面打开时会自动读取已发布的账号 JSON 与订阅 YAML。
- 点击 **一键清空生成信息** 会清空图中的 4 项内容（公开订阅地址、镜像订阅地址、Clash 导入链接、账号 JSON）以及输出区，并在 `localStorage` 写入标记——**下次打开页面不会再自动载入**，这就是修复前“清空后仍能看到”的原因。
- 需要恢复：点 **恢复订阅地址**（只恢复三条地址）或 **刷新订阅内容**（恢复全部）。

### 本地转换

把账号 JSON 粘贴到网页输入框，点击“从账号 JSON 生成输出”，可在本地得到 Clash YAML、sing-box、`.conf` 与 `masque://` 链接。本地转换不上传任何数据。

> 需要 **mihomo Alpha** 内核（稳定版不支持 `type: masque`）。
> 标准 WireGuard `.conf` 与 sing-box 需要 32 字节 X25519 私钥；`usque` 注册的 MASQUE 账号使用 EC P-256 密钥，无法直接转换，页面会给出提示（用 `wgcf` 注册的账号可直接导出）。

## 版本回滚

- 每次生成会在 `configs/history/` 写入 `warp-masque-<时间戳>.yaml`，并更新 `index.json`（保留最近 N 份，超出自动清理）。
- 页面“配置版本”列表支持 **查看 / 下载 / 回滚**；回滚会把版本号复制到剪贴板并打开 `rollback.yml` 工作流，粘贴运行即可恢复该版本（回滚前会把当前版本另存为 `-prerollback` 快照）。

## 隐私提醒

公开仓库里的 `configs/warp-masque.yaml`、`configs/usque-config.json`、`configs/history/` 和 artifact 都**包含私钥**，等同于账号凭据。任何拿到订阅链接的人都能使用该 WARP 账号。工作流默认定时任务会提交（否则 Pages 订阅无法自动更新）；如不希望公开，请把仓库改为私有并关闭 Pages，或只在本地使用粘贴转换。

不要高频运行工作流，Cloudflare 会风控 WARP 设备注册。若 Token 权限允许，可为 `Pages 健康检查` 配置 `PAGES_TOKEN` secret，以便自动恢复 Pages。

## 目录

```text
index.html                            静态页面（生成器 / 自检 / 版本）
assets/style.css                      样式
assets/app.js                         本地转换、清空记忆、自检、版本列表
assets/template.js                    Clash YAML 模板
scripts/generate.py                   测速 + 多格式生成 + 快照 + meta
scripts/validate.py                   订阅结构校验
.github/workflows/generate-warp.yml   生成工作流（含每 6 小时定时）
.github/workflows/rollback.yml        版本回滚工作流
.github/workflows/pages-health.yml    Pages 健康检查与恢复
configs/warp-masque.yaml              当前订阅（含私钥）
configs/usque-config.json             原始账号（页面自动载入）
configs/meta.json                     生成时间 / 下次更新 / 节点统计
configs/health.json                   端点测速报告与排查提示
configs/history/                      历史快照与 index.json
LICENSE / NOTICE                      许可与出处
.nojekyll                            GitHub Pages 标记
```

## 致谢与许可

本项目为独立实现，采用 AGPL-3.0 许可。非官方项目，与 Cloudflare、Amnezia 无关联。使用 WARP 请遵守 Cloudflare 条款与所在地区法律。
