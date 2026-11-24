# AmneziaWG · Config Lab（静态版）

一个部署在 GitHub Pages 上的纯前端 AmneziaWG / Cloudflare WARP 配置生成器，参照 [awgconfig.com](https://awgconfig.com/) 的配置结构实现。

在线地址：<https://looomix.github.io/AmneziaWG/>

## 功能

- AWG 1.5 / 2.0 / 3.0 / 3.1 四种档位，生成结构与原站一致（Jc/Jmin/Jmax、S1–S4、H1–H4、I1 CPS、AWG 3.x 时序区间等）。
- 全隧道 / 分流路由、DNS 预设、Endpoint 与 UDP 端口、IPv6、路由器 / 移动设备模式、批量生成 1–3 份。
- 高级参数：CPS 协议、I1 十六进制链、Jitter 覆盖、额外 I2–I5。
- 安全预览（隐藏私钥）、复制、下载 `.conf`、本机历史记录（最多 20 条）。
- 环境自检：JavaScript、X25519、localStorage、网络状态。

## 与 awgconfig.com 的差异

原站通过服务端向 Cloudflare WARP API 注册设备，因此点击一次即可拿到全新密钥。GitHub Pages 只能托管静态文件，浏览器直连 Cloudflare API 会被 CORS 阻止。本站因此采用：

1. **WARP 模式**：粘贴由官方客户端或 `wgcf` 生成的账户 JSON / `.conf`，读取其中已注册的 `PrivateKey`，再本地组装 AWG 配置。
2. **自建服务器模式**：用 Web Crypto 的 X25519 在本地生成新私钥，填入服务端公钥、地址与 Endpoint。

页面不会发出任何注册请求，也不会上传密钥。`vpn://` 链接需要 AmneziaVPN 的 protobuf 编码器，静态版不提供；请用 `.conf` 导入。内置分流 CIDR 是演示用示例，不是实时 IP 库。

## 本地预览

无需构建工具，任意静态服务器即可：

```bash
python -m http.server 8000
# 打开 http://localhost:8000/
```

> 直接双击 `index.html` 也能打开，但部分浏览器会限制剪贴板 API。

## 目录结构

```text
index.html          页面结构
assets/style.css    样式
assets/app.js       配置生成、密钥处理、历史与交互
LICENSE             AGPL-3.0（与原项目保持一致）
NOTICE              出处与差异说明
.nojekyll           阻止 Jekyll 处理
```

## 致谢与许可

配置字段与参数范围参考了 [HereIamGosu/amnezia-config-gen](https://github.com/HereIamGosu/amnezia-config-gen)（AGPL-3.0）。本站是独立编写的静态实现，保留相同许可证并附 [NOTICE](NOTICE)。

本项目为非官方作品，与 Cloudflare、Amnezia 团队无关联。使用 WARP 需遵守 Cloudflare 的服务条款，并遵守所在地区法律。
