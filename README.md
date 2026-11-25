# Cloudflare WARP 配置生成器（Warp-Masque free）

用 GitHub Actions 在服务端注册 WARP 设备，探测优选端点后生成 Mihomo/Clash MASQUE 订阅与 `masque://` 分享链接。纯静态页面，无需 Worker 或自建服务器。

## 功能

| 能力 | 说明 |
| --- | --- |
| 云端生成 | Runner 内运行 `usque` 注册设备 |
| 节点池 | MASQUE 固定池：v4×4 + v6×4 地址 × 7 端口（443/500/1701/4500/4443/8443/8095），共 56 个 |
| 探测优选 | QUIC 版本协商探测（UDP 真实可达），已验证的按延迟升序在前，不可达的剔除 |
| 导出 | Clash / Mihomo YAML 订阅、`masque://` 分享链接 |
| 连通性自检 | Runner 探测报告 + 浏览器实测，失败给出端口 / SNI / 内核版本提示 |
| 手动触发 | 手动运行 Actions 生成，页面显示上次生成时间与节点状态 |
| 一键清空 | 清空账号 JSON 与订阅地址并记住状态，再次点击恢复 |

## 使用

1. Actions 中打开 `generate-warp.yml`，点 **Run workflow**。
2. 可设设备名、是否测速、延迟阈值、`commit` 与 artifact 保留天数；`commit` 默认关闭，勾选后才把含私钥的配置提交到仓库。
3. 流程：下载 `usque` 注册设备 → 探测端点 → `generate.py` 生成订阅 YAML、链接、`health.json`、`meta.json` → `validate.py` 校验 → 上传 artifact，按需提交。
4. 订阅地址在页面查看。

仅手动触发，无定时任务。

## 清空行为

- 页面打开时自动读取已发布的账号 JSON 与订阅 YAML。
- **一键清空** 清空三条订阅地址、账号 JSON 与输出区，并写入 `localStorage` 标记，下次打开不再自动载入。
- 清空后按钮变为 **恢复生成信息**，点一下重新载入地址与已发布配置。

## 本地转换

账号 JSON 粘贴到输入框，点“从账号 JSON 生成输出”即可本地得到 YAML 与 `masque://` 链接，不上传任何数据。

> 需要 **mihomo Alpha** 内核，稳定版不支持 `type: masque`。
> 订阅里的节点是同一个 WARP 账号的不同接入地址，出口 IP 相同；多节点解决的是某个 IP/端口被墙或限速时能自动换一个，不是多地区落地。

## 隐私

`configs/` 下的订阅、账号文件与 artifact 均含私钥，等同账号凭据，拿到订阅链接即可使用该 WARP 账号。如需保密，请改为私有仓库或仅在本页粘贴转换。

避免高频运行工作流，Cloudflare 会风控设备注册。

## 目录

```text
index.html                            静态页面（生成器 / 自检）
assets/style.css                      样式
assets/app.js                         本地转换、清空记忆、自检
assets/template.js                    Clash YAML 模板
scripts/generate.py                   探测 + 订阅/链接生成 + meta
scripts/validate.py                   订阅结构校验
.github/workflows/generate-warp.yml   生成工作流
configs/warp-masque.yaml              当前订阅
configs/warp-masque-links.txt         masque:// 分享链接
configs/usque-config.json             原始账号
configs/meta.json                     生成时间 / 节点统计
configs/health.json                   端点探测报告
LICENSE / NOTICE                      许可与出处
.nojekyll                             GitHub Pages 标记
```

## 许可

独立实现，AGPL-3.0。非官方项目，与 Cloudflare、Amnezia 无关联。使用 WARP 请遵守 Cloudflare 条款与当地法律。
