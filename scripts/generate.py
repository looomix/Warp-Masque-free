#!/usr/bin/env python3
"""Convert a usque `config.json` into a Clash/Mihomo MASQUE subscription.

Usage: python3 scripts/generate.py <config.json> <output-dir>
"""
import json
import os
import sys
import urllib.parse
from datetime import datetime

V4 = ["162.159.198.2", "162.159.199.2"]
V6 = ["2606:4700:103::2", "2606:4700:104::2"]
PORTS = (443, 4443, 8443, 8095)
SNI = "www.cloudflareaccess.com"
RS = "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite"


def pem_body(value):
    return "".join(
        line for line in str(value or "").splitlines()
        if not line.startswith("-----")
    ).replace(" ", "")


def load(path):
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    required = ("private_key", "endpoint_pub_key", "ipv4")
    missing = [key for key in required if not data.get(key)]
    if missing:
        raise SystemExit("config.json 缺少字段: " + ", ".join(missing))
    return data


def build_nodes(config, include_v6=True):
    servers = list(V4) + (list(V6) if include_v6 else [])
    nodes = []
    for server in servers:
        for port in PORTS:
            nodes.append((server, port))
    return nodes


def main():
    if len(sys.argv) != 3:
        raise SystemExit("用法: python3 generate.py <config.json> <输出目录>")
    config = load(sys.argv[1])
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)

    private_key = str(config["private_key"]).strip()
    public_key = pem_body(config["endpoint_pub_key"])
    ipv4 = str(config["ipv4"]).strip()
    ipv6 = str(config.get("ipv6") or "").strip()
    nodes = build_nodes(config, bool(ipv6))
    names = []

    proxy_lines = []
    shadowrocket = []
    for server, port in nodes:
        name = f"WARP | {server} | {port}"
        names.append(name)
        ipv6_line = f"\n    ipv6: {ipv6}" if ipv6 else ""
        proxy_lines.append(
            '  - name: "%s"\n'
            "    type: masque\n"
            "    server: %s\n"
            "    port: %d\n"
            "    private-key: %s\n"
            "    public-key: %s\n"
            "    ip: %s%s\n"
            "    uri: https://cloudflareaccess.com\n"
            "    mtu: 1280\n"
            "    udp: true\n"
            "    remote-dns-resolve: true\n"
            "    congestion-controller: bbr\n"
            "    dns: [ 1.1.1.1, 8.8.8.8 ]\n"
            "    sni: %s" % (name, server, port, private_key, public_key, ipv4, ipv6_line, SNI)
        )
        params = "&".join([
            "publicKey=" + urllib.parse.quote(public_key, safe=""),
            "privateKey=" + urllib.parse.quote(private_key, safe=""),
            "ip=" + urllib.parse.quote(ipv4, safe=""),
            "dns=1.1.1.1",
            "udp=1",
            "cc=bbr",
            "sni=" + urllib.parse.quote(SNI, safe=""),
        ])
        host = f"[{server}]" if ":" in server else server
        shadowrocket.append(f"masque://{host}:{port}?{params}#{urllib.parse.quote(name)}")

    name_block = "\n".join(f"      - \"{name}\"" for name in names)
    sets = ["private", "cn", "google", "youtube", "telegram", "github", "microsoft", "apple"]
    providers = "\n".join(
        f'  {item}: {{type: http, behavior: domain, format: mrs, url: "{RS}/{item}.mrs", interval: 86400}}'
        for item in sets
    )
    rules = "\n".join(
        f"  - RULE-SET,{item},{'DIRECT' if item in ('private', 'cn') else '节点选择'}" for item in sets
    )

    yaml = f"""# Cloudflare WARP MASQUE 订阅 · GitHub Actions 自动生成
# 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
# 需要 mihomo Alpha 内核；private-key 等同账号凭据，请勿公开转发
mode: rule
allow-lan: false
mixed-port: 7890
bind-address: 127.0.0.1
ipv6: true
unified-delay: true
tcp-concurrent: true
log-level: info
global-ua: clash.meta

external-controller: 127.0.0.1:9090
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

dns:
  enable: true
  ipv6: true
  listen: 0.0.0.0:1053
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  default-nameserver: [223.5.5.5, 119.29.29.29]
  nameserver:
    - https://223.5.5.5/dns-query
    - https://1.12.12.12/dns-query
  nameserver-policy:
    'geosite:cn,private':
      - https://223.5.5.5/dns-query
      - https://1.12.12.12/dns-query
    'geosite:geolocation-!cn':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query

proxies:
{chr(10).join(proxy_lines)}

proxy-groups:
  - name: 节点选择
    type: select
    proxies: [自动选择, 故障转移, 手动切换, DIRECT]
  - name: 手动切换
    type: select
    proxies:
{name_block}
  - name: 自动选择
    type: url-test
    url: https://cloudflare.com/cdn-cgi/trace
    interval: 300
    tolerance: 30
    lazy: true
    proxies:
{name_block}
  - name: 故障转移
    type: fallback
    url: https://cloudflare.com/cdn-cgi/trace
    interval: 180
    proxies:
{name_block}

rule-providers:
{providers}

rules:
{rules}
  - MATCH,节点选择
"""

    with open(os.path.join(outdir, "warp-masque.yaml"), "w", encoding="utf-8") as handle:
        handle.write(yaml)
    with open(os.path.join(outdir, "warp-masque-shadowrocket.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(shadowrocket) + "\n")
    print(f"生成 {len(nodes)} 个 MASQUE 节点 -> {outdir}")


if __name__ == "__main__":
    main()
