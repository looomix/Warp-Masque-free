window.MASQUE_TEMPLATE = `# Warp-Masque free · 由 m2c.pages.dev 的结构启发，独立实现
# 生成时间: __TIME__
# 版本: __VERSION__
# 提示：请保持 Mihomo/Clash.Meta 内核为最新版；本配置含私钥，请勿公开分享

mode: rule
allow-lan: true
mixed-port: 7890
bind-address: '*'
ipv6: __IPV6__
unified-delay: true
tcp-concurrent: true
log-level: info
global-ua: clash.meta

external-controller: 127.0.0.1:9090
external-ui: ui

profile:
  store-selected: true
  store-fake-ip: true

sniffer:
  enable: true
  sniff:
    HTTP:
      ports: [80, 8080-8880]
      override-destination: true
    TLS:
      ports: [443, 8443]
    QUIC:
      ports: [443, 8443]

tun:
  enable: false
  stack: mixed
  dns-hijack:
    - "any:53"
  auto-route: true
  auto-detect-interface: true

dns:
  enable: true
  ipv6: __DNS_IPV6__
  listen: 0.0.0.0:1053
  enhanced-mode: __DNS_MODE__
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - geosite:private
    - geosite:cn
    - "*.lan"
    - "*.local"
    - localhost.ptlogin2.qq.com
    - time.windows.com
    - time.apple.com
  use-hosts: true
  respect-rules: true
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  nameserver-policy:
    "geosite:cn":
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query
    "geosite:geolocation-!cn":
      - https://cloudflare-dns.com/dns-query#proxy=节点选择
      - https://dns.google/dns-query#proxy=节点选择
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29

proxies:
__PROXIES__

proxy-groups:
  - name: 节点选择
    type: select
    proxies: [自动端点, 手动端点, 故障转移, 负载均衡, __PROXY_NAMES__, 国内直连]
    icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Rocket.png"
  - name: 自动端点
    type: url-test
    url: __TEST_URL__
    interval: __TEST_INTERVAL__
    tolerance: __TEST_TOLERANCE__
    lazy: true
    proxies: __OFFICIAL_NAMES__
  - name: 手动端点
    type: select
    proxies: __PROXY_NAMES__
  - name: 故障转移
    type: fallback
    url: __TEST_URL__
    interval: __TEST_INTERVAL__
    proxies: __PROXY_NAMES__
  - name: 负载均衡
    type: load-balance
    url: __TEST_URL__
    interval: __TEST_INTERVAL__
    proxies: __PROXY_NAMES__
  - name: 国内直连
    type: select
    proxies: [DIRECT]
  - name: FINAL
    type: select
    proxies: [节点选择, 自动端点, 手动端点, 国内直连]
__RULES_BLOCK__
`;
