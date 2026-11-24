# Cloudflare WARP 配置生成器（Warp-Masque free）

用 **GitHub Actions** 在服务端注册 Cloudflare WARP 设备并生成 Mihomo/Clash 的 MASQUE 订阅；站点本身是纯静态 GitHub Pages，不需要 Cloudflare Worker，也不需要自己的服务器。

在线站点：<https://looomix.github.io/Warp-Masque-free/>
仓库：<https://github.com/looomix/Warp-Masque-free>

## 使用方式

### 云端一键生成（推荐）

1. 打开 [Actions 工作流](https://github.com/looomix/Warp-Masque-free/actions/workflows/generate-warp.yml)。
2. 点击 **Run workflow**，可选择设备名、是否提交配置、artifact 保留天数。
3. 工作流会：
   - 下载 `usque` 并注册一台 WARP/MASQUE 设备；
   - 运行 `scripts/generate.py` 生成 40+ 个 MASQUE 节点；
   - 把 `configs/warp-masque.yaml` 和 `configs/usque-config.json` 提交回仓库（触发 Pages 更新）；
   - 上传 `warp-masque.yaml`、`warp-masque-shadowrocket.txt` 和原始 `usque-config.json` 作为 artifact。
4. 订阅地址：  
   <https://looomix.github.io/Warp-Masque-free/configs/warp-masque.yaml>  
   镜像订阅地址（gh-proxy）：  
   <https://gh-proxy.com/https://raw.githubusercontent.com/looomix/Warp-Masque-free/main/configs/warp-masque.yaml>  
   Clash 导入链接（使用镜像）：  
   `clash://install-config?url=https%3A%2F%2Fgh-proxy.com%2Fhttps%3A%2F%2Fraw.githubusercontent.com%2Flooomix%2FWarp-Masque-free%2Fmain%2Fconfigs%2Fwarp-masque.yaml`

页面打开时会自动读取 `configs/usque-config.json` 填入账号输入框并生成预览，无需手动复制。

> 需要 **mihomo Alpha** 内核（稳定版不支持 `type: masque`）。

### 本地转换

把 usque / m2c 生成的账号 JSON 粘贴到网页输入框，点击“从账号 JSON 生成输出”，可在本地得到 Clash YAML 与（当账号含 X25519 私钥时）WireGuard/AWG `.conf`。本地转换不上传任何数据。

## 隐私提醒

公开仓库里的 `configs/warp-masque.yaml`、`configs/usque-config.json` 和 artifact 都**包含私钥**，等同于账号凭据。任何拿到订阅链接的人都能使用该 WARP 账号。请避免公开转发，必要时把 Fork 设为私有，或在 Actions 运行时把 `commit` 取消、只下载 artifact（此时页面不会自动载入账号）。

不要高频运行工作流，Cloudflare 会风控 WARP 设备注册。

## 目录

```text
index.html                     静态页面
assets/style.css               样式
assets/app.js                  本地账号转换与输出
assets/template.js             Clash YAML 模板
scripts/generate.py            usque config.json -> Clash YAML
.github/workflows/generate-warp.yml  Actions 工作流
configs/warp-masque.yaml       工作流生成的订阅（含私钥）
configs/usque-config.json      工作流生成的原始账号（页面自动载入）
LICENSE / NOTICE               许可与出处
.nojekyll                      GitHub Pages 标记
```

## 致谢与许可

本项目为独立实现，采用 AGPL-3.0 许可。非官方项目，与 Cloudflare、Amnezia 无关联。使用 WARP 请遵守 Cloudflare 条款与所在地区法律。
