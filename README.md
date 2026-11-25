# Cloudflare WARP 配置生成器（Warp-Masque free）

用 GitHub Actions 在服务端注册 WARP 设备，测速优选后生成 Mihomo/Clash、sing-box、WireGuard 等配置。纯静态页面，无需 Worker 或自建服务器。

## 功能

| 能力 | 说明 |
| --- | --- |
| 云端生成 | Runner 内运行 `usque` 注册设备 |
| 测速优选 | 并发探测 4 端点 × 4 端口，剔除不可达端点，按延迟排序写入订阅 |
| 版本回滚 | 保留最近 N 份快照，页面可查看/下载，`rollback.yml` 一键回滚 |
| 多格式导出 | Clash YAML、sing-box JSON、WireGuard `.conf`、`masque://` 链接 |
| 连通性自检 | Runner 测速报告 + 浏览器实测，失败给出端口 / SNI / 内核版本提示 |
| 手动触发 | 手动运行 Actions 生成，页面显示上次生成时间与节点状态 |
| 一键清空 | 清空账号 JSON 与订阅地址，并记住状态，下次打开保持空白 |

## 使用

1. 打开 Actions 中的 `generate-warp.yml`，点 **Run workflow**。
2. 可设设备名、是否测速、延迟阈值、快照数量、`commit` 与 artifact 保留天数。
   `commit` 默认关闭，勾选后才会把含私钥的配置提交到仓库（页面订阅随之更新）。
3. 工作流依次完成：下载 `usque` 并注册设备 → 测速筛选端点 → `scripts/generate.py` 生成订阅/多格式配置/`health.json`/`meta.json`/快照 → `scripts/validate.py` 校验 → 上传 artifact，按需提交回仓库。
4. 订阅地址在站点页面查看。

仅手动触发，无定时任务。

## 清空行为

- 页面打开时自动读取已发布的账号 JSON 与订阅 YAML。
- **一键清空** 清空订阅地址 ×2、Clash 导入链接、账号 JSON 及输出区，并写入 `localStorage` 标记，下次打开不再自动载入。
- 恢复：**恢复订阅地址**（仅三条地址）或 **刷新订阅内容**（全部恢复）。

## 本地转换

账号 JSON 粘贴到输入框，点“从账号 JSON 生成输出”即可在本地得到各格式配置，不上传任何数据。

> 需要 **mihomo Alpha** 内核，稳定版不支持 `type: masque`。
> `.conf` 与 sing-box 需 32 字节 X25519 私钥；`usque` 账号为 EC P-256，无法直接转换（`wgcf` 账号可导出）。

## 隐私

`configs/` 下的订阅、账号文件、历史快照与 artifact 均含私钥，等同账号凭据，拿到订阅链接即可使用该 WARP 账号。如需保密，请改为私有仓库或仅在本页粘贴转换。

避免高频运行工作流，Cloudflare 会风控设备注册。

## 目录

```text
index.html                            静态页面（生成器 / 自检 / 版本）
assets/style.css                      样式
assets/app.js                         本地转换、清空记忆、自检、版本列表
assets/template.js                    Clash YAML 模板
scripts/generate.py                   测速 + 多格式生成 + 快照 + meta
scripts/validate.py                   订阅结构校验
.github/workflows/generate-warp.yml   生成工作流
.github/workflows/rollback.yml        版本回滚
.github/workflows/pages-health.yml    Pages 健康检查
configs/warp-masque.yaml              当前订阅
configs/usque-config.json             原始账号
configs/meta.json                     生成时间 / 节点统计
configs/health.json                   端点测速报告
configs/history/                      历史快照与 index.json
LICENSE / NOTICE                      许可与出处
.nojekyll                             GitHub Pages 标记
```

## 许可

独立实现，AGPL-3.0。非官方项目，与 Cloudflare、Amnezia 无关联。使用 WARP 请遵守 Cloudflare 条款与当地法律。
