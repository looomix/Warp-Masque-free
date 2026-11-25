#!/usr/bin/env python3
"""Convert a usque `config.json` into WARP / MASQUE subscription artifacts.

Usage:
    python3 scripts/generate.py <config.json> <outdir> [options]

Outputs (inside <outdir>):
    warp-masque.yaml            Mihomo / Clash.Meta MASQUE subscription
    warp-masque.conf            Standard WireGuard .conf (WARP peer)
    warp-masque-singbox.json    sing-box outbound config
    warp-masque-links.txt       masque:// share links (Shadowrocket style)
    warp-masque-shadowrocket.txt  same links, legacy file name
    health.json                 per-endpoint reachability probe report
    meta.json                   generation metadata (time / stats)

Optional: `--history-dir configs/history --keep 10` keeps timestamped
snapshots plus an `index.json` so the web page can list / roll back versions.
"""
import argparse
import base64
import binascii
import json
import os
import socket
import ssl
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

V4 = ["162.159.198.2", "162.159.199.2"]
V6 = ["2606:4700:103::2", "2606:4700:104::2"]
PORTS = (443, 4443, 8443, 8095)
SNI = "www.cloudflareaccess.com"
RS = "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite"
TEST_URL = "https://cloudflare.com/cdn-cgi/trace"
WARP_PEER = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo="
KERNEL_HINT = "masque 出站需要 Mihomo Alpha 内核（>= 1.19.0-alpha）；稳定版会报 unknown proxy type"
BEIJING = timezone(timedelta(hours=8))


def local_stamp():
    """Runner 默认是 UTC，这里统一按北京时间输出可读时间。"""
    return datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M:%S")


def pem_body(value):
    return "".join(
        line for line in str(value or "").splitlines()
        if not line.startswith("-----")
    ).replace(" ", "")


def x25519_key(value):
    """usque/WARP MASQUE 账号用的是 EC P-256 密钥（PKCS#8），
    而标准 WireGuard / sing-box 需要 32 字节 X25519 私钥。
    只有能解出 32 字节时才返回该 base64 字符串，否则返回 None。
    """
    text = str(value or "").strip()
    try:
        raw = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        return None
    return text if len(raw) == 32 else None


def load(path):
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    required = ("private_key", "endpoint_pub_key", "ipv4")
    missing = [key for key in required if not data.get(key)]
    if missing:
        raise SystemExit("config.json 缺少字段: " + ", ".join(missing))
    return data


def build_nodes(include_v6=True):
    servers = list(V4) + (list(V6) if include_v6 else [])
    return [(server, port) for server in servers for port in PORTS]


# ---------------------------------------------------------------- probing ----

def probe(server, port, timeout=2.5, sni=SNI):
    """Reachability probe run from the Actions runner.

    port 443 / 8443 -> TCP connect + TLS handshake (SNI), other ports -> TCP.
    This measures endpoint reachability from the runner, not tunnel quality;
    a failure usually means runner egress or the port is blocked.
    """
    method = "tls" if port in (443, 8443) else "tcp"
    started = time.perf_counter()
    sock = None
    try:
        sock = socket.create_connection((server, port), timeout=timeout)
        if method == "tls":
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            sock = ctx.wrap_socket(sock, server_hostname=sni)
        latency = round((time.perf_counter() - started) * 1000)
        return {"server": server, "port": port, "ok": True, "latencyMs": latency,
                "method": method, "error": None}
    except socket.timeout:
        return {"server": server, "port": port, "ok": False, "latencyMs": None,
                "method": method, "error": "timeout"}
    except ConnectionRefusedError:
        return {"server": server, "port": port, "ok": False, "latencyMs": None,
                "method": method, "error": "refused"}
    except socket.gaierror:
        return {"server": server, "port": port, "ok": False, "latencyMs": None,
                "method": method, "error": "dns"}
    except ssl.SSLError as exc:
        return {"server": server, "port": port, "ok": False, "latencyMs": None,
                "method": method, "error": "tls: " + str(exc)[:80]}
    except OSError as exc:
        return {"server": server, "port": port, "ok": False, "latencyMs": None,
                "method": method, "error": str(exc)[:80]}
    finally:
        try:
            if sock is not None:
                sock.close()
        except OSError:
            pass


def probe_all(nodes, timeout, workers=16):
    with ThreadPoolExecutor(max_workers=max(1, min(workers, len(nodes)))) as pool:
        return list(pool.map(lambda n: probe(n[0], n[1], timeout), nodes))


def build_health(results, max_latency):
    def kept(result):
        return bool(result["ok"]) and (result["latencyMs"] or 10 ** 9) <= max_latency

    nodes = [dict(r, kept=kept(r)) for r in results]
    nodes.sort(key=lambda r: (not r["kept"], r["latencyMs"] or 10 ** 9))
    healthy = [r for r in nodes if r["kept"]]
    ports = {}
    for r in results:
        item = ports.setdefault(r["port"], {"port": r["port"], "ok": 0, "fail": 0})
        item["ok" if r["ok"] else "fail"] += 1
    hints = []
    if not healthy:
        hints.append("Runner 侧未连通任何端点：优先确认 GitHub Runner 出口是否限制目标端口，或勾选“跳过测速”直接发布。")
    dead = [str(p["port"]) for p in ports.values() if p["ok"] == 0]
    if dead:
        hints.append("端口 " + " / ".join(dead) + " 全部探测失败：客户端若只放行 443，请在生成器把 MASQUE 端口改为 443 或 8443。")
    slow = [r for r in nodes if r["ok"] and not r["kept"]]
    if slow:
        hints.append(f"{len(slow)} 个端点可达但延迟超过 {max_latency}ms，已从订阅中剔除；可在运行工作流时调高 max_latency。")
    if any(p["ok"] > 0 for p in ports.values() if p["port"] != 443):
        hints.append("非 443 端口可达，说明网络未强制只放行 443；建议优先使用延迟最低的那组节点。")
    hints.append(KERNEL_HINT)
    hints.append("若订阅导入后全部超时：核对 SNI（默认 www.cloudflareaccess.com）、系统时间误差 < 60 秒、MTU 1280。")
    return {
        "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sni": SNI,
        "testUrl": TEST_URL,
        "maxLatency": max_latency,
        "total": len(results),
        "healthy": len(healthy),
        "dropped": len(results) - len(healthy),
        "ports": sorted(ports.values(), key=lambda p: p["port"]),
        "nodes": nodes,
        "hints": hints,
    }


# ------------------------------------------------------------------ formats ---

def proxy_block(name, server, port, private_key, public_key, ipv4, ipv6, latency_note):
    ipv6_line = f"\n    ipv6: {ipv6}" if ipv6 else ""
    head = f"  # 延迟 {latency_note}\n" if latency_note else ""
    return head + (
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


def masque_link(name, server, port, private_key, public_key, ipv4):
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
    return f"masque://{host}:{port}?{params}#{urllib.parse.quote(name)}"


def build_conf(private_key, ipv4, ipv6, server, port=2408):
    address = f"{ipv4}/32" + (f", {ipv6}/128" if ipv6 else "")
    allowed = "0.0.0.0/0" + (", ::/0" if ipv6 else "")
    return f"""# Cloudflare WARP · 标准 WireGuard 配置（由 Warp-Masque free 生成）
# 生成时间: {local_stamp()}
# 客户端: WireGuard 官方客户端 / wg-quick；AWG 伪装参数请在页面生成
[Interface]
PrivateKey = {private_key}
Address = {address}
DNS = 1.1.1.1, 1.0.0.1
MTU = 1280

[Peer]
PublicKey = {WARP_PEER}
AllowedIPs = {allowed}
Endpoint = {server}:{port}
PersistentKeepalive = 25
"""


def build_singbox(private_key, ipv4, ipv6, nodes, latency_map):
    """sing-box 1.13+ 结构：WireGuard 已改为 endpoints[]，不再是 outbound。"""
    local = [f"{ipv4}/32"] + ([f"{ipv6}/128"] if ipv6 else [])
    allowed = ["0.0.0.0/0"] + (["::/0"] if ipv6 else [])
    endpoints = []
    names = []
    for server, port in nodes:
        name = f"WARP | {server} | {port}"
        names.append(name)
        latency = latency_map.get((server, port))
        endpoint = {
            "type": "wireguard",
            "tag": name,
            "system": False,
            "mtu": 1280,
            "address": local,
            "private_key": private_key,
            "udp_timeout": "5m",
            "peers": [{
                "address": server,
                "port": port,
                "public_key": WARP_PEER,
                "allowed_ips": allowed,
                "persistent_keepalive_interval": 25,
            }],
        }
        if latency:
            endpoint["_note"] = f"Action 侧测得 {latency}ms；sing-box 无 masque 出站，此处用 WireGuard 接入 WARP"
        endpoints.append(endpoint)
    outbounds = [
        {"type": "selector", "tag": "节点选择",
         "outbounds": ["自动选择", "手动切换", "direct"], "default": "自动选择"},
        {"type": "urltest", "tag": "自动选择", "outbounds": names,
         "url": TEST_URL, "interval": "5m", "tolerance": 50, "idle_timeout": "30m"},
        {"type": "selector", "tag": "手动切换", "outbounds": names, "default": names[0]},
        {"type": "direct", "tag": "direct"},
    ]
    return json.dumps({
        "_comment": "由 Warp-Masque free 生成；含私钥，请当作凭据保管；需要 sing-box >= 1.13",
        "_generatedAt": local_stamp(),
        "log": {"level": "info", "timestamp": True},
        "dns": {
            "servers": [
                {"tag": "proxy-dns", "address": "https://1.1.1.1/dns-query", "detour": "节点选择"},
                {"tag": "local-dns", "address": "223.5.5.5", "detour": "direct"},
            ],
            "rules": [{"rule_set": "geosite-cn", "server": "local-dns"}],
            "final": "proxy-dns",
        },
        "inbounds": [{"type": "mixed", "tag": "mixed-in", "listen": "127.0.0.1", "listen_port": 7890}],
        "endpoints": endpoints,
        "outbounds": outbounds,
        "route": {
            "rules": [{"rule_set": "geosite-cn", "outbound": "direct"}],
            "rule_set": [{
                "tag": "geosite-cn", "type": "remote", "format": "binary",
                "url": f"{RS}/cn.mrs", "download_detour": "direct",
            }],
            "final": "节点选择",
            "auto_detect_interface": True,
        },
    }, ensure_ascii=False, indent=2) + "\n"


# ------------------------------------------------------------------ history ---

def write_history(history_dir, yaml_text, summary, keep):
    os.makedirs(history_dir, exist_ok=True)
    stamp = datetime.now(BEIJING).strftime("%Y%m%d-%H%M%S")
    filename = f"warp-masque-{stamp}.yaml"
    path = os.path.join(history_dir, filename)
    suffix = 1
    while os.path.exists(path):
        suffix += 1
        filename = f"warp-masque-{stamp}-{suffix}.yaml"
        path = os.path.join(history_dir, filename)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(yaml_text)

    index_path = os.path.join(history_dir, "index.json")
    try:
        with open(index_path, "r", encoding="utf-8") as handle:
            index = json.load(handle)
        if not isinstance(index, dict):
            index = {}
    except (OSError, json.JSONDecodeError):
        index = {}
    versions = index.get("versions") or []
    version = filename[len("warp-masque-"):-len(".yaml")]
    versions.insert(0, {
        "version": version,
        "file": filename,
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "createdAtLocal": local_stamp(),
        **summary,
    })
    versions = versions[:keep]
    index = {"updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "keep": keep, "versions": versions}
    with open(index_path, "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    # prune snapshots that fell out of the index
    alive = {v["file"] for v in versions}
    for name in os.listdir(history_dir):
        if name.startswith("warp-masque-") and name.endswith(".yaml") and name not in alive:
            try:
                os.remove(os.path.join(history_dir, name))
            except OSError:
                pass
    return version


# --------------------------------------------------------------------- main ---

def main():
    parser = argparse.ArgumentParser(description="生成 WARP MASQUE 订阅与多客户端配置")
    parser.add_argument("config", help="usque config.json")
    parser.add_argument("outdir", help="输出目录")
    parser.add_argument("--no-probe", action="store_true", help="跳过端点测速")
    parser.add_argument("--max-latency", type=int, default=1200, help="延迟阈值（毫秒）")
    parser.add_argument("--timeout", type=float, default=2.5, help="单端点探测超时（秒）")
    parser.add_argument("--top", type=int, default=0, help="只保留最快的前 N 个节点（0 = 不限制）")
    parser.add_argument("--history-dir", default="", help="配置快照目录，例如 configs/history")
    parser.add_argument("--keep", type=int, default=10, help="保留最近 N 份快照")
    args = parser.parse_args()

    config = load(args.config)
    outdir = args.outdir
    os.makedirs(outdir, exist_ok=True)

    private_key = str(config["private_key"]).strip()
    public_key = pem_body(config["endpoint_pub_key"])
    ipv4 = str(config["ipv4"]).strip()
    ipv6 = str(config.get("ipv6") or "").strip()
    candidates = build_nodes(bool(ipv6))

    if args.no_probe:
        health = {
            "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "skipped": True, "total": len(candidates), "healthy": 0, "dropped": 0,
            "ports": [], "nodes": [], "hints": ["本次运行跳过了测速，节点按默认顺序发布。"],
        }
        selected = candidates
        latency_map = {}
    else:
        print(f"测速 {len(candidates)} 个端点（超时 {args.timeout}s，阈值 {args.max_latency}ms）…")
        results = probe_all(candidates, args.timeout)
        health = build_health(results, args.max_latency)
        latency_map = {(r["server"], r["port"]): r["latencyMs"] for r in results if r["ok"]}
        healthy = [(r["server"], r["port"]) for r in health["nodes"] if r["kept"]]
        if healthy:
            selected = healthy
        else:
            # 全部失败时不要发布空订阅：保留全量并在 health.json 里说明原因
            selected = candidates
            health["fallback"] = True
        if args.top and args.top > 0:
            selected = selected[:args.top]

    names = []
    proxy_lines = []
    links = []
    for server, port in selected:
        name = f"WARP | {server} | {port}"
        names.append(name)
        latency = latency_map.get((server, port))
        proxy_lines.append(proxy_block(name, server, port, private_key, public_key,
                                       ipv4, ipv6, f"{latency}ms" if latency else "未测速"))
        links.append(masque_link(name, server, port, private_key, public_key, ipv4))

    name_block = "\n".join(f'      - "{name}"' for name in names)
    sets = ["private", "cn", "google", "youtube", "telegram", "github", "microsoft", "apple"]
    providers = "\n".join(
        f'  {item}: {{type: http, behavior: domain, format: mrs, url: "{RS}/{item}.mrs", interval: 86400}}'
        for item in sets
    )
    rules = "\n".join(
        f"  - RULE-SET,{item},{'DIRECT' if item in ('private', 'cn') else '节点选择'}" for item in sets
    )
    best = selected[0]
    best_latency = latency_map.get(best)

    yaml = f"""# Cloudflare WARP MASQUE 订阅 · GitHub Actions 自动生成
# 生成时间: {local_stamp()}
# 节点: {len(selected)} 个（已按测速结果从快到慢排序，剔除不可达端点）
# 内核: {KERNEL_HINT}
# private-key 等同账号凭据，请勿公开转发
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
    url: {TEST_URL}
    interval: 300
    tolerance: 30
    lazy: true
    proxies:
{name_block}
  - name: 故障转移
    type: fallback
    url: {TEST_URL}
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
    links_text = "\n".join(links) + "\n"
    for name in ("warp-masque-links.txt", "warp-masque-shadowrocket.txt"):
        with open(os.path.join(outdir, name), "w", encoding="utf-8") as handle:
            handle.write(links_text)

    # 标准 WireGuard / sing-box 需要 X25519 密钥；usque 的 MASQUE 账号是 EC P-256，
    # 此时不写出无法使用的配置，只在 meta 里标注原因，页面会给出说明。
    wg_key = x25519_key(private_key)
    exports = {"clash": True, "links": True, "wireguard": False, "singbox": False}
    blocked_reason = ""
    if wg_key:
        with open(os.path.join(outdir, "warp-masque.conf"), "w", encoding="utf-8") as handle:
            handle.write(build_conf(wg_key, ipv4, ipv6, best[0]))
        with open(os.path.join(outdir, "warp-masque-singbox.json"), "w", encoding="utf-8") as handle:
            handle.write(build_singbox(wg_key, ipv4, ipv6, selected, latency_map))
        exports["wireguard"] = True
        exports["singbox"] = True
    else:
        blocked_reason = ("当前账号是 MASQUE（EC P-256）密钥，标准 WireGuard .conf / sing-box "
                          "需要 32 字节 X25519 私钥，无法直接转换；如需 .conf 请用 wgcf 注册一个 WARP 账号，"
                          "或继续使用 Clash / MASQUE 订阅。")
        exports["reason"] = blocked_reason

    with open(os.path.join(outdir, "health.json"), "w", encoding="utf-8") as handle:
        json.dump(health, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    now = datetime.now(timezone.utc)
    meta = {
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generatedAtLocal": local_stamp(),
        "nodes": len(selected),
        "healthy": health.get("healthy", 0),
        "dropped": health.get("dropped", 0),
        "probed": not args.no_probe,
        "bestEndpoint": {"server": best[0], "port": best[1], "latencyMs": best_latency},
        "kernel": KERNEL_HINT,
        "formats": [k for k, v in exports.items() if v is True],
        "blockedFormatReason": blocked_reason,
    }
    with open(os.path.join(outdir, "meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    if args.history_dir:
        summary = {
            "nodes": len(selected),
            "healthy": health.get("healthy", 0),
            "bestLatencyMs": best_latency,
            "bestEndpoint": f"{best[0]}:{best[1]}",
        }
        meta["version"] = write_history(args.history_dir, yaml, summary, max(1, args.keep))

    print(f"生成 {len(selected)} 个 MASQUE 节点 -> {outdir}")
    if not args.no_probe:
        print(f"健康节点 {health.get('healthy', 0)}/{health.get('total', 0)}，"
              f"最优 {best[0]}:{best[1]} {best_latency}ms")
    produced = ["warp-masque.yaml", "warp-masque-links.txt", "health.json", "meta.json"]
    if exports.get("wireguard"):
        produced += ["warp-masque.conf", "warp-masque-singbox.json"]
    print("输出: " + " / ".join(produced))


if __name__ == "__main__":
    main()
