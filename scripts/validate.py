#!/usr/bin/env python3
"""Structural validation for the generated Mihomo MASQUE subscription."""
import re
import sys

import yaml

REQUIRED = ("proxies", "proxy-groups", "rules", "rule-providers", "dns")


def fail(message):
    raise SystemExit("校验失败: " + message)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("用法: python3 validate.py <subscription.yaml>")
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        raw = handle.read()
    if re.search(r"__[A-Z_0-9]+__", raw):
        fail("存在未替换的模板占位符")
    try:
        data = yaml.safe_load(raw)
    except Exception as exc:
        fail(f"YAML 解析错误: {exc}")
    if not isinstance(data, dict):
        fail("根节点必须是映射")
    for key in REQUIRED:
        if key not in data:
            fail(f"缺少字段 {key}")

    proxies = data.get("proxies") or []
    if not isinstance(proxies, list) or not proxies or len(proxies) > 100:
        fail("proxies 数量异常（测速会剔除不可达端点，1-100 个都视为正常）")
    names = [p.get("name") for p in proxies if isinstance(p, dict)]
    if len(names) != len(set(names)):
        fail("存在重复的节点名称")
    for proxy in proxies:
        if proxy.get("type") != "masque":
            fail("存在非 masque 节点")
        for key in ("server", "port", "private-key", "public-key", "ip", "dns", "sni"):
            if not proxy.get(key):
                fail(f"节点缺少 {key}")
    groups = [g.get("name") for g in (data.get("proxy-groups") or []) if isinstance(g, dict)]
    for required in ("节点选择", "自动选择", "故障转移", "手动切换"):
        if required not in groups:
            fail(f"缺少策略组 {required}")
    if data.get("allow-lan") is not False:
        fail("allow-lan 必须为 false")
    print(f"校验通过: {len(proxies)} 个 MASQUE 节点，{len(groups)} 个策略组")


if __name__ == "__main__":
    main()
