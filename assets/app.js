(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const VERSION = "1.0.0";

  const pemBody = (v) => String(v ?? "").replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----/g, "").replace(/\s/g, "");
  const b64urlEncode = (text) => {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  const b64urlDecode = (value) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 4200);
  }

  function parseAccount(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("请先填入 MASQUE 账号 JSON");
    const root = JSON.parse(raw);
    const account = root && root.success && root.content ? root.content : root;
    const missing = ["private_key", "endpoint_pub_key", "ipv4"].filter((k) => !account[k]);
    if (missing.length) throw new Error(`缺少必要字段：${missing.join(", ")}`);
    return {
      privateKey: String(account.private_key).trim(),
      publicKey: pemBody(account.endpoint_pub_key),
      ipv4: String(account.ipv4).trim(),
      ipv6: account.ipv6 ? String(account.ipv6).trim() : "",
    };
  }

  function endpointList(account) {
    const mode = $("#endpointMode").value;
    const wantV6 = $("#ipv6").checked;
    const suffix = $("#namePrefix").value.trim() || "MASQUE导航";
    const ports = $("#portMode").value === "random" ? [500, 4500, 8095, 443] : [Number($("#portMode").value)];
    let servers;
    if (mode === "single") {
      servers = [$("#singleEndpoint").value.trim() || "www.cloudflareaccess.com"].map((server) => ({ server, prefix: "自定义" }));
    } else if (mode === "v6") {
      servers = (wantV6 ? ["2606:4700:103::1", "2606:4700:103::2", "2606:4700:104::1", "2606:4700:104::2"] : []).map((server) => ({ server, prefix: "官方 IPv6" }));
    } else if (mode === "v4") {
      servers = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"].map((server) => ({ server, prefix: "官方" }));
    } else {
      servers = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"].map((server) => ({ server, prefix: "官方" }));
      if (wantV6) {
        servers.push(...["2606:4700:103::1", "2606:4700:103::2", "2606:4700:104::1", "2606:4700:104::2"].map((server) => ({ server, prefix: "官方 IPv6" })));
      }
    }
    if (!servers.length) throw new Error("请启用 IPv6 或更换 Endpoint 范围");
    const nodes = [];
    servers.forEach(({ server, prefix }) => ports.forEach((port) => nodes.push({ server, port, prefix, suffix })));
    return nodes;
  }

  function rulesBlock() {
    if (!$("#rules").checked) return "";
    const base = "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite";
    const sets = [
      ["private", "private"],
      ["cn", "cn"],
      ["google", "google"],
      ["youtube", "youtube"],
      ["telegram", "telegram"],
      ["github", "github"],
      ["microsoft", "microsoft"],
      ["apple", "apple"],
    ];
    const providers = sets.map(([name, file]) => `  ${name}: {type: http, behavior: domain, format: mrs, url: "${base}/${file}.mrs", interval: 86400}`).join("\n");
    return `\nrule-providers:\n${providers}\n\nrules:\n  - RULE-SET,private,DIRECT\n  - RULE-SET,cn,DIRECT\n${sets.filter(([n]) => n !== "private" && n !== "cn").map(([n]) => `  - RULE-SET,${n},节点选择`).join("\n")}\n  - MATCH,FINAL\n`;
  }

  function buildYaml(account) {
    const nodes = endpointList(account);
    const network = $('input[name="network"]:checked').value;
    const networkLine = network === "h2" ? "\n    network: h2" : network === "h3-l4proxy" ? "\n    network: h3-l4proxy" : "";
    const udp = $("#udp").checked;
    const ipv6Line = account.ipv6 && $("#ipv6").checked ? `\n    ipv6: ${account.ipv6}` : "";
    const proxies = nodes
      .map((node) => {
        const name = `${node.prefix} | ${node.server} | ${node.port} | ${node.suffix}`;
        return `  - name: "${name}"\n    type: masque\n    server: ${node.server}\n    port: ${node.port}\n    private-key: ${account.privateKey}\n    public-key: ${account.publicKey}\n    ip: ${account.ipv4}${ipv6Line}\n    uri: https://cloudflareaccess.com\n    mtu: 1280\n    udp: ${udp}\n    remote-dns-resolve: true\n    congestion-controller: ${$("#cc").value}\n    sni: ${$("#sni").value.trim() || "www.cloudflareaccess.com"}${networkLine}`;
      })
      .join("\n\n");
    const names = nodes.map((n) => `"${n.prefix} | ${n.server} | ${n.port} | ${n.suffix}"`).join(", ");
    const official = nodes
      .filter((n) => n.prefix.startsWith("官方"))
      .map((n) => `"${n.prefix} | ${n.server} | ${n.port} | ${n.suffix}"`)
      .join(", ");

    return window.MASQUE_TEMPLATE
      .replace("__TIME__", new Date().toLocaleString("zh-CN"))
      .replace("__VERSION__", VERSION)
      .replace(/__IPV6__/g, $("#ipv6").checked ? "true" : "false")
      .replace("__DNS_IPV6__", $("#ipv6").checked ? "true" : "false")
      .replace("__DNS_MODE__", $("#dnsMode").value)
      .replace("__PROXIES__", proxies)
      .replace(/__PROXY_NAMES__/g, `[${names}]`)
      .replace("__OFFICIAL_NAMES__", official ? `[${official}]` : `[${names}]`)
      .replace(/__TEST_URL__/g, $("#testUrl").value.trim() || "https://cloudflare.com/cdn-cgi/trace")
      .replace(/__TEST_INTERVAL__/g, $("#interval").value || "300")
      .replace(/__TEST_TOLERANCE__/g, $("#tolerance").value || "30")
      .replace("__RULES_BLOCK__", rulesBlock());
  }

  function showResult(yaml, meta) {
    $("#result").hidden = false;
    $("#resultMeta").textContent = meta;
    $("#yamlPreview").textContent = yaml;
    $("#subLink").value = `${location.origin}${location.pathname}#sub=${b64urlEncode(yaml)}`;
    $("#remoteSub").value = "";
  }

  async function uploadSubscription(yaml) {
    const base = $("#subApi").value.trim().replace(/\/$/, "");
    if (!base) return null;
    const response = await fetch(`${base}/api/sub`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "clash", content: yaml, tier: "24h" }),
    });
    if (!response.ok) throw new Error(`订阅托管返回 HTTP ${response.status}`);
    const data = await response.json();
    return data.url || (data.data && data.data.url) || null;
  }

  async function generate({ upload = false } = {}) {
    try {
      const account = parseAccount($("#accountText").value);
      const yaml = buildYaml(account);
      const network = $('input[name="network"]:checked').value.toUpperCase();
      showResult(yaml, `${network} · ${$("#endpointMode").value} · ${$("#portMode").value === "random" ? "随机端口" : $("#portMode").value} · 本地生成`);
      toast("YAML 与订阅链接已生成");
      if (upload) {
        const url = await uploadSubscription(yaml);
        if (url) {
          $("#remoteSub").value = url;
          toast("远程订阅地址已生成");
        } else {
          toast("订阅托管未返回地址");
        }
      }
    } catch (error) {
      toast(error.message);
    }
  }

  async function oneClick() {
    const button = $("#oneClick");
    button.disabled = true;
    button.textContent = "正在注册…";
    try {
      const api = $("#regApi").value.trim();
      if (!api) throw new Error("请填写注册接口");
      const response = await fetch(api, { method: "GET", cache: "no-store" });
      const data = await response.json();
      const account = data && data.success && data.content ? data.content : data;
      if (!account || !account.private_key) throw new Error(data && data.message ? data.message : "注册服务未返回账号");
      $("#accountText").value = JSON.stringify(account, null, 2);
      $("#accountStatus").textContent = "注册成功，已自动填入账号。";
      await generate();
    } catch (error) {
      $("#accountStatus").textContent = "一键注册失败：请到原站获取账号 JSON，或填写自己的注册接口。";
      toast(`一键注册失败：${error.message}。可粘贴原站账号 JSON 后手动生成。`);
    } finally {
      button.disabled = false;
      button.textContent = "一键注册并生成";
    }
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      toast(message);
    }
  }

  function bindEvents() {
    $("#oneClick").addEventListener("click", oneClick);
    $("#generate").addEventListener("click", () => generate({ upload: true }));
    $("#loadDemo").addEventListener("click", () => {
      $("#accountText").value = JSON.stringify(
        {
          private_key: "MHcCAQEEI" + "A".repeat(120),
          endpoint_pub_key: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE" + "A".repeat(64) + "\n-----END PUBLIC KEY-----",
          ipv4: "172.16.0.2",
          ipv6: "2606:4700:110::1",
          endpoint_v4: "162.159.198.2",
          note: "示例结构，仅用于预览生成的 YAML，不能用于连接",
        },
        null,
        2
      );
      $("#accountStatus").textContent = "已填入示例结构（无法连接，仅预览）。";
    });
    $("#copyYaml").addEventListener("click", () => copyText($("#yamlPreview").textContent, "YAML 已复制"));
    $("#copySub").addEventListener("click", () => copyText($("#subLink").value, "订阅链接已复制"));
    $("#copyRemote").addEventListener("click", () => copyText($("#remoteSub").value, "远程订阅地址已复制"));
    $("#openSub").addEventListener("click", () => window.open($("#subLink").value, "_blank", "noopener"));
    $("#downloadYaml").addEventListener("click", () => {
      const yaml = $("#yamlPreview").textContent;
      if (!yaml) return;
      const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "MASQUE-To-Clash.yaml";
      a.click();
      URL.revokeObjectURL(url);
      toast("YAML 已下载");
    });
  }

  function restoreFromHash() {
    const match = location.hash.match(/^#sub=(.+)$/);
    if (!match) return;
    try {
      const yaml = b64urlDecode(match[1]);
      showResult(yaml, "从订阅链接恢复");
      $("#accountStatus").textContent = "已从订阅链接恢复 YAML，可复制或下载。";
    } catch {
      toast("订阅链接解析失败");
    }
  }

  bindEvents();
  restoreFromHash();
})();
