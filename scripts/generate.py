#!/usr/bin/env python3
"""Convert a usque `config.json` into a WARP / MASQUE subscription.

Usage:
    python3 scripts/generate.py <config.json> <outdir> [options]

Outputs (inside <outdir>):
    warp-masque.yaml    Mihomo / Clash.Meta MASQUE subscription
    warp-masque-links.txt   masque:// share links
    health.json         per-endpoint reachability probe report
    meta.json           generation metadata (time / stats)
"""
import argparse
import json
import os
import socket
import ssl
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

# Cloudflare MASQUE 只在这几个 anycast 段上应答（每段 2 个地址），
# 端口固定为 443/500/1701/4500/4443/8443/8095，4x7=28 个 v4、4x7=28 个 v6 端点。
V4 = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"]
V6 = ["2606:4700:103::1", "2606:4700:103::2", "2606:4700:104::1", "2606:4700:104::2"]
PORTS = (443, 500, 1701, 4500, 4443, 8443, 8095)
TLS_PORTS = (443, 8443)
QUIC_PROBE_VERSION = b"\x00\x00\x00\x02"  # 不支持的版本号，用于套出 Version Negotiation
SNI = "www.cloudflareaccess.com"
RS = "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite"
TEST_URL = "https://cloudflare.com/cdn-cgi/trace"
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

def _family(server):
    return "v6" if ":" in server else "v4"


NO_ROUTE_CODES = {101, 113, 51, 65, 10051, 10065}  # ENETUNREACH / EHOSTUNREACH（含 Windows WSA）


def _net_error(exc):
    """把 errno 归一成可读原因，ENETUNREACH/EHOSTUNREACH 单独标记（主机没有该协议出口）。"""
    code = getattr(exc, "errno", None) or getattr(exc, "winerror", None)
    if code in NO_ROUTE_CODES:
        return "unroutable"
    return (str(exc)[:60] or type(exc).__name__)


def host_has_ipv6():
    """UDP connect 只做路由查找，不真的发包：没有 IPv6 出口时会直接报 ENETUNREACH。"""
    sock = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
    try:
        sock.connect((V6[0], 443))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def probe_quic(server, port, timeout, attempts=4):
    """用一个不支持的 QUIC 版本号套出 Version Negotiation，判断 UDP 上是否真有 MASQUE 服务。

    Cloudflare 对 Version Negotiation 做了限速，单次没有回包不代表端点不可用，
    所以默认重试 3 次；任意一次收到回包即视为可达，取最快一次作为 RTT。
    """
    dcid, scid = os.urandom(8), os.urandom(8)
    packet = b"\xc0" + QUIC_PROBE_VERSION + bytes([len(dcid)]) + dcid
    packet += bytes([len(scid)]) + scid
    packet += b"\x00" * (1200 - len(packet))
    family = socket.AF_INET6 if _family(server) == "v6" else socket.AF_INET
    best, last, hits = None, "quic 无响应", 0
    for _ in range(max(1, attempts)):
        sock = socket.socket(family, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        started = time.perf_counter()
        try:
            sock.sendto(packet, (server, port))
            sock.recvfrom(2048)
            latency = round((time.perf_counter() - started) * 1000)
            best = latency if best is None else min(best, latency)
            hits += 1
            if hits >= 2:   # 取两次的最快值，压掉限速引起的排队抖动
                break
        except socket.timeout:
            last = "quic 无响应"
        except OSError as exc:
            last = _net_error(exc)
        finally:
            sock.close()
    return best, last


def probe_tls(server, port, timeout, sni):
    """443/8443 上的 TCP+TLS：只用来确认 H2 传输是否可用。"""
    sock = None
    started = time.perf_counter()
    try:
        sock = socket.create_connection((server, port), timeout=timeout)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        sock = ctx.wrap_socket(sock, server_hostname=sni)
        return round((time.perf_counter() - started) * 1000), None
    except Exception as exc:  # 探测失败原因需要原样展示
        return None, _net_error(exc)
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


def probe(server, port, timeout=2.0, sni=SNI):
    """先探 QUIC（MASQUE 的真实传输层），443/8443 再补一次 TLS 判断 H2。"""
    latency, error = probe_quic(server, port, timeout)
    base = {"server": server, "port": port, "family": _family(server)}
    if latency is not None:
        return dict(base, ok=True, latencyMs=latency, method="quic", error=None, unroutable=False)
    unroutable = error == "unroutable"
    if port in TLS_PORTS and not unroutable:
        tls_latency, tls_error = probe_tls(server, port, timeout, sni)
        if tls_latency is not None:
            return dict(base, ok=True, latencyMs=tls_latency, method="tls", error=None, unroutable=False)
        error = "quic: %s / tls: %s" % (error, tls_error)
    return dict(base, ok=False, latencyMs=None,
                method="quic+tls" if port in TLS_PORTS else "quic",
                error=error, unroutable=unroutable)


def probe_all(nodes, timeout, workers=8):
    with ThreadPoolExecutor(max_workers=max(1, min(workers, len(nodes)))) as pool:
        return list(pool.map(lambda n: probe(n[0], n[1], timeout), nodes))


def classify(results, max_latency, has_ipv6=True):
    """区分「已验证可用」「未验证但保留」「剔除」三种端点。

    - 探测到 QUIC/TLS 回包且在阈值内 -> 已验证
    - 探测有回包但太慢 -> 剔除
    - 整批 IPv6 都是 ENETUNREACH（Runner 没有 IPv6 出口）-> 保留但标注未验证，
      因为客户端本身可能有 IPv6；否则剔除
    """
    v6_fail = [r for r in results if r["family"] == "v6" and not r["ok"]]
    v6_unroutable = not has_ipv6 or (bool(v6_fail) and all(r["unroutable"] for r in v6_fail))
    nodes = []
    for result in results:
        item = dict(result)
        item["verified"] = bool(result["ok"])
        if result["ok"]:
            item["kept"] = (result["latencyMs"] or 10 ** 9) <= max_latency
            item["reason"] = None if item["kept"] else "延迟超阈值"
        elif result["family"] == "v6" and v6_unroutable:
            item["kept"] = True
            item["reason"] = "Runner 无 IPv6 出口"
        else:
            item["kept"] = False
            item["reason"] = "探测无响应"
        nodes.append(item)
    nodes.sort(key=lambda r: (not r["verified"], not r["kept"], r["latencyMs"] or 10 ** 9))
    return nodes, v6_unroutable


def make_health(results, nodes, published, max_latency, v6_unroutable):
    ports = {}
    for result in results:
        item = ports.setdefault(result["port"], {"port": result["port"], "ok": 0, "fail": 0})
        item["ok" if result["ok"] else "fail"] += 1
    verified = [n for n in nodes if n["verified"] and n["kept"]]
    unverified = [n for n in nodes if n["kept"] and not n["verified"]]
    slow = [n for n in nodes if n["verified"] and not n["kept"]]
    hints = []
    if not verified:
        hints.append("Runner 侧没有任何端点完成 QUIC 握手：先勾选“跳过测速”发布，再确认 Runner 出口是否允许 UDP。")
    if v6_unroutable:
        hints.append("Runner 没有 IPv6 出口：IPv6 端点无法验证但仍写入订阅，客户端有 IPv6 时才可用。")
    dead = [str(p["port"]) for p in ports.values() if p["ok"] == 0]
    if dead:
        hints.append("端口 " + " / ".join(dead) + " 全部无响应，已按端口剔除；客户端若只放行 443 请优先用 443 节点。")
    if slow:
        hints.append(f"{len(slow)} 个端点延迟超过 {max_latency}ms 已剔除，可在运行工作流时调高 max_latency。")
    hints.append(KERNEL_HINT)
    hints.append("若订阅导入后全部超时：核对 SNI（默认 www.cloudflareaccess.com）、系统时间误差 < 60 秒、MTU 1280。")
    return {
        "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sni": SNI,
        "testUrl": TEST_URL,
        "maxLatency": max_latency,
        "total": len(results),
        "verified": len(verified),
        "unverified": len(unverified),
        "published": published,
        "dropped": len(results) - published,
        "ports": sorted(ports.values(), key=lambda p: p["port"]),
        "nodes": nodes,
        "hints": hints,
    }


# ------------------------------------------------------------------ formats ---

def proxy_block(name, server, port, private_key, public_key, ipv4, ipv6, note):
    ipv6_line = f"\n    ipv6: {ipv6}" if ipv6 else ""
    head = f"  # {note}\n" if note else ""
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


# --------------------------------------------------------------------- main ---

def main():
    parser = argparse.ArgumentParser(description="生成 WARP MASQUE 订阅与 masque:// 分享链接")
    parser.add_argument("config", help="usque config.json")
    parser.add_argument("outdir", help="输出目录")
    parser.add_argument("--no-probe", action="store_true", help="跳过端点测速")
    parser.add_argument("--max-latency", type=int, default=1200, help="延迟阈值（毫秒）")
    parser.add_argument("--timeout", type=float, default=1.6, help="单次 QUIC 探测超时（秒），每个端点最多试 3 次")
    parser.add_argument("--top", type=int, default=0, help="只保留最快的前 N 个节点（0 = 不限制）")
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
        selected = candidates
        notes = {(s, p): "未测速" for s, p in candidates}
        health = {
            "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "skipped": True, "total": len(candidates), "verified": 0,
            "unverified": len(candidates), "published": len(candidates),
            "dropped": 0, "ports": [], "nodes": [],
            "hints": ["本次运行跳过测速，端点池按原样发布（未验证）。"],
        }
    else:
        print(f"探测 {len(candidates)} 个端点（QUIC，超时 {args.timeout}s，阈值 {args.max_latency}ms）…")
        has_ipv6 = host_has_ipv6()
        print("Runner IPv6 出口:", "有" if has_ipv6 else "无（IPv6 端点标注为未验证，不探测）")
        if has_ipv6:
            results = probe_all(candidates, args.timeout)
        else:
            # 没有 IPv6 出口就别浪费超时等待，直接标记为未验证
            results = probe_all([c for c in candidates if _family(c[0]) == "v4"], args.timeout)
            results += [dict(server=s, port=p, family="v6", ok=False, latencyMs=None,
                             method="跳过", error="Runner 无 IPv6 出口", unroutable=True)
                        for s, p in candidates if _family(s) == "v6"]
        nodes, v6_unroutable = classify(results, args.max_latency, has_ipv6)
        kept = [(n["server"], n["port"]) for n in nodes if n["kept"]]
        # 全部失败时不要发布空订阅：退回全量端点并在 health.json 说明
        selected = kept or candidates
        if args.top and args.top > 0:
            selected = selected[:args.top]
        notes = {}
        for node in nodes:
            key = (node["server"], node["port"])
            if not node["kept"]:
                continue
            notes[key] = f"延迟 {node['latencyMs']}ms" if node["verified"] else f"未验证（{node['reason']}）"
        health = make_health(results, nodes, len(selected), args.max_latency, v6_unroutable)
        if not kept:
            health["fallback"] = True

    names = []
    proxy_lines = []
    links = []
    for server, port in selected:
        name = f"WARP | {server} | {port}"
        names.append(name)
        proxy_lines.append(proxy_block(name, server, port, private_key, public_key,
                                       ipv4, ipv6, notes.get((server, port), "未测速")))
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
    latency_map = {(n["server"], n["port"]): n["latencyMs"]
                   for n in health.get("nodes", []) if n["verified"]}
    best = selected[0]
    best_latency = latency_map.get(best)

    yaml = f"""# Cloudflare WARP MASQUE 订阅 · GitHub Actions 自动生成
# 生成时间: {local_stamp()}
# 节点: {len(selected)} 个（已验证端点按延迟升序在前，未验证端点在后）
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
    with open(os.path.join(outdir, "warp-masque-links.txt"), "w", encoding="utf-8") as handle:
        handle.write(links_text)

    with open(os.path.join(outdir, "health.json"), "w", encoding="utf-8") as handle:
        json.dump(health, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    now = datetime.now(timezone.utc)
    meta = {
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generatedAtLocal": local_stamp(),
        "nodes": len(selected),
        "verified": health.get("verified", 0),
        "unverified": health.get("unverified", 0),
        "dropped": health.get("dropped", 0),
        "probed": not args.no_probe,
        "bestEndpoint": {"server": best[0], "port": best[1], "latencyMs": best_latency},
        "kernel": KERNEL_HINT,
    }

    with open(os.path.join(outdir, "meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"生成 {len(selected)} 个 MASQUE 节点 -> {outdir}")
    if not args.no_probe:
        print(f"已验证 {health.get('verified', 0)}/{health.get('total', 0)}，"
              f"未验证 {health.get('unverified', 0)}，最优 {best[0]}:{best[1]} {best_latency}ms")
    print("输出: warp-masque.yaml / warp-masque-links.txt / health.json / meta.json")


if __name__ == "__main__":
    main()
