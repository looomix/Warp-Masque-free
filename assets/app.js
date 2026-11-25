(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const WARP_PEER = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";
  const SUB_URL = "https://looomix.github.io/Warp-Masque-free/configs/warp-masque.yaml";
  const MIRROR_URL = "https://gh-proxy.com/https://raw.githubusercontent.com/looomix/Warp-Masque-free/main/configs/warp-masque.yaml";
  const IMPORT_URL = `clash://install-config?url=${encodeURIComponent(MIRROR_URL)}`;
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const hexText = (text) => Array.from(new TextEncoder().encode(text)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const pemBody = (value) => String(value || "").replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----/g, "").replace(/\s/g, "");
  const state = { account: null, canonicalYaml: "", manualOverride: false, outputs: { conf: "", yaml: "", sub: "" }, tab: "yaml" };

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 4500);
  }

  function status(message, error = false) {
    const el = $("#accountStatus");
    el.textContent = message;
    el.style.color = error ? "#fda4af" : "";
  }

  function i1Payload() {
    const branch = "z" + Math.random().toString(36).slice(2, 12);
    const tag = String(rand(10000000, 99999999));
    const payload = `INVITE sip:bob@cloudflareaccess.com SIP/2.0\r\nVia: SIP/2.0/UDP pc33.cloudflareaccess.com;branch=${branch}\r\nTo: Bob <sip:bob@cloudflareaccess.com>\r\nFrom: Alice <sip:alice@cloudflareaccess.com>;tag=${tag}\r\nCall-ID: ${tag}@cloudflareaccess.com\r\nCSeq: ${rand(100000, 999999)} INVITE\r\nContent-Length: 0\r\n\r\n`;
    return `<b 0x${hexText(payload)}>`;
  }

  function awgFields(mode) {
    let jc = rand(3, 24);
    let jmin = rand(64, 700);
    let jmax = rand(Math.max(jmin + 64, 128), 1024);
    const lines = [];
    if (mode === "legacy") {
      jc = rand(3, 150);
      jmin = rand(20, 60);
      jmax = rand(700, 1000);
      lines.push(`S1 = 0`, `S2 = 0`);
    } else {
      lines.push(`Jc = ${jc}`, `Jmin = ${jmin}`, `Jmax = ${jmax}`);
      [0, 0, 0, 0].forEach((v, i) => lines.push(`S${i + 1} = ${v}`));
      lines.push(`I1 = ${i1Payload()}`);
    }
    if (mode === "legacy") lines.push(`Jc = ${jc}`, `Jmin = ${jmin}`, `Jmax = ${jmax}`);
    ["1", "2", "3", "4"].forEach((v, i) => lines.push(`H${i + 1} = ${v}`));
    if (mode === "awg3" || mode === "awg31") {
      lines.push(
        "ContentPaddingAddition = 10-100",
        "RekeyAfterTime = 100-120",
        "RekeyTimeout = 3-7",
        "RejectAfterTime = 150-180",
        "KeepaliveTimeout = 5-15",
        "MaxHandshakeAttempts = 15-20"
      );
    }
    return lines;
  }

  function buildConf() {
    if (!state.account || !state.account.wgPrivate) return "当前账号没有 X25519 WireGuard 私钥，无法生成 .conf。请使用 usque/wgcf 生成的 WARP 账号，或通过 Actions 生成 MASQUE 订阅。";
    const mode = $("#profile").value;
    const a = state.account;
    const lines = [
      "[Interface]",
      `PrivateKey = ${a.wgPrivate}`,
      `Address = ${$("#ipv6").checked && a.ipv6 ? `${a.ipv4}, ${a.ipv6}` : a.ipv4}`,
      "DNS = 1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001",
      "MTU = 1280",
      ...awgFields(mode),
      "",
      "[Peer]",
      `PublicKey = ${WARP_PEER}`,
      `AllowedIPs = ${$("#ipv6").checked && a.ipv6 ? "0.0.0.0/0, ::/0" : "0.0.0.0/0"}`,
      `Endpoint = ${a.endpoint}:${$("#wgPort").value}`,
      "PersistentKeepalive = 25",
      "",
    ];
    return lines.join("\n");
  }

  function endpointNodes() {
    const wantV6 = $("#ipv6").checked;
    const mode = $("#endpointMode").value;
    const ports = $("#portMode").value === "random" ? [443, 500, 1701, 4500] : [Number($("#portMode").value)];
    let servers;
    if (mode === "v6") servers = wantV6 ? ["2606:4700:103::2", "2606:4700:104::2"] : [];
    else if (mode === "v4") servers = ["162.159.198.2", "162.159.199.2"];
    else {
      servers = ["162.159.198.2", "162.159.199.2"];
      if (wantV6) servers.push("2606:4700:103::2", "2606:4700:104::2");
    }
    if (!servers.length) throw new Error("请启用 IPv6 或更换 Endpoint 范围");
    return servers.flatMap((server) => ports.map((port) => ({ server, port })));
  }

  function rulesBlock() {
    if (!$("#rules").checked) return "";
    const base = "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite";
    const sets = ["private", "cn", "google", "youtube", "telegram", "github", "microsoft", "apple"];
    const providers = sets.map((n) => `  ${n}: {type: http, behavior: domain, format: mrs, url: "${base}/${n}.mrs", interval: 86400}`).join("\n");
    const rules = sets.map((n) => `  - RULE-SET,${n},${n === "private" || n === "cn" ? "DIRECT" : "节点选择"}`).join("\n");
    return `\nrule-providers:\n${providers}\n\nrules:\n${rules}\n  - MATCH,节点选择\n`;
  }

  function buildYaml() {
    const a = state.account;
    if (!a || !a.privateKey || !a.publicKey) return "当前账号缺少 MASQUE private_key 或 endpoint_pub_key，无法生成 Clash YAML。";
    const nodes = endpointNodes();
    const network = $("#network").value;
    const networkLine = network === "h2" ? "\n    network: h2" : network === "h3-l4proxy" ? "\n    network: h3-l4proxy" : "";
    const ipv6Line = $("#ipv6").checked && a.ipv6 ? `\n    ipv6: ${a.ipv6}` : "";
    const proxies = nodes
      .map((n) => {
        const name = `WARP | ${n.server} | ${n.port}`;
        return `  - name: "${name}"\n    type: masque\n    server: ${n.server}\n    port: ${n.port}\n    private-key: ${a.privateKey}\n    public-key: ${pemBody(a.publicKey)}\n    ip: ${a.ipv4}${ipv6Line}\n    uri: https://cloudflareaccess.com\n    mtu: 1280\n    udp: ${$("#udp").checked}\n    remote-dns-resolve: true\n    congestion-controller: ${$("#cc").value}\n    sni: ${$("#sni").value.trim() || "www.cloudflareaccess.com"}${networkLine}`;
      })
      .join("\n\n");
    const names = nodes.map((n) => `"WARP | ${n.server} | ${n.port}"`).join(", ");

    return window.MASQUE_TEMPLATE
      .replace("__TIME__", new Date().toLocaleString("zh-CN"))
      .replace("__VERSION__", "3.0.0-actions")
      .replace(/__IPV6__/g, $("#ipv6").checked ? "true" : "false")
      .replace("__DNS_IPV6__", $("#ipv6").checked ? "true" : "false")
      .replace("__DNS_MODE__", "fake-ip")
      .replace("__PROXIES__", proxies)
      .replace(/__PROXY_NAMES__/g, `[${names}]`)
      .replace("__OFFICIAL_NAMES__", `[${names}]`)
      .replace(/__TEST_URL__/g, $("#testUrl").value.trim() || "https://cloudflare.com/cdn-cgi/trace")
      .replace(/__TEST_INTERVAL__/g, "300")
      .replace(/__TEST_TOLERANCE__/g, "30")
      .replace("__RULES_BLOCK__", rulesBlock());
  }

  function showTab(tab) {
    state.tab = tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $("#output").textContent = state.outputs[tab] || "尚未生成，请先粘贴账号 JSON。";
    $("#copyOutput").disabled = !state.outputs[tab];
    $("#downloadOutput").disabled = tab === "sub";
  }

  function render() {
    state.outputs.conf = buildConf();
    state.outputs.yaml = state.manualOverride || !state.canonicalYaml ? buildYaml() : state.canonicalYaml;
    state.outputs.sub = [
      "公开订阅地址（GitHub Pages）：",
      SUB_URL,
      "",
      "镜像订阅地址（gh-proxy）：",
      MIRROR_URL,
      "",
      "Clash 导入链接（镜像）：",
      IMPORT_URL,
      "",
      "私钥不会编码进 URL。需要本地备份请使用“下载文件”或“复制”。",
    ].join("\n");
    $("#result").hidden = false;
    $("#resultMeta").textContent = `${$("#profile").value.toUpperCase()} · ${$("#network").value.toUpperCase()} · 本地转换`;
    showTab(state.tab);
  }

  function parseAccount() {
    const raw = $("#accountText").value.trim();
    if (!raw) throw new Error("请先粘贴账号 JSON，或使用 Actions 生成的公开订阅");
    const root = JSON.parse(raw);
    const account = root && root.success && root.content ? root.content : root;
    const privateKey = account.private_key || account.privateKey || "";
    const publicKey = account.endpoint_pub_key || account.public_key || "";
    const ipv4 = account.ipv4 || account.address || "172.16.0.2";
    const ipv6 = account.ipv6 || "";
    if (!privateKey) throw new Error("账号缺少 private_key");
    state.account = {
      privateKey,
      publicKey,
      wgPrivate: pemBody(privateKey).length === 43 ? privateKey : "",
      ipv4,
      ipv6,
      endpoint: account.endpoint_v4 || account.endpoint || "engage.cloudflareclient.com",
    };
  }

  async function copyText(text, message = "已复制") {
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
    $("#generate").addEventListener("click", () => {
      try {
        parseAccount();
        state.manualOverride = true;
        render();
        status("已从账号 JSON 本地生成配置（本地预览，可能与订阅内容不同）。");
        toast("配置已生成");
      } catch (error) {
        toast(error.message);
      }
    });
    $("#reloadSub").addEventListener("click", () => loadPublishedConfig(true));
    $("#copyRemote").addEventListener("click", () => copyText(SUB_URL, "订阅地址已复制"));
    $("#copyMirror").addEventListener("click", () => copyText(MIRROR_URL, "镜像地址已复制"));
    $("#copyImport").addEventListener("click", () => copyText(IMPORT_URL, "导入链接已复制"));
    $("#copyOutput").addEventListener("click", () => copyText(state.outputs[state.tab] || ""));
    $("#downloadOutput").addEventListener("click", () => {
      const text = state.outputs[state.tab];
      if (!text || state.tab === "sub") return;
      const ext = state.tab === "yaml" ? "yaml" : "conf";
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WARP-${state.tab}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    });
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
    $("#loadDemo").addEventListener("click", () => {
      $("#accountText").value = JSON.stringify(
        {
          private_key: "MHcCAQEEI" + "A".repeat(120),
          endpoint_pub_key: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE" + "A".repeat(64) + "\n-----END PUBLIC KEY-----",
          ipv4: "172.16.0.2",
          ipv6: "2606:4700:110::1",
          endpoint_v4: "engage.cloudflareclient.com",
          note: "示例结构，仅用于预览，不能连接",
        },
        null,
        2
      );
      status("已填入示例结构（仅预览，不能连接）。");
    });
  }

  async function loadPublishedConfig(announce = false) {
    status("正在读取已发布的配置…");
    const stamp = Date.now();
    let account = null;
    let yaml = null;
    try {
      const accountResponse = await fetch(`configs/usque-config.json?t=${stamp}`, { cache: "no-store" });
      if (accountResponse.ok) account = await accountResponse.json();
    } catch { /* 账号文件可能未公开 */ }
    try {
      const yamlResponse = await fetch(`configs/warp-masque.yaml?t=${stamp}`, { cache: "no-store" });
      if (yamlResponse.ok) yaml = await yamlResponse.text();
    } catch { /* 订阅文件可能未公开 */ }

    if (!account && !yaml) {
      status("未找到已发布的配置。请运行 Actions（开启 commit）或手动粘贴账号。", true);
      return;
    }
    if (account) {
      $("#accountText").value = JSON.stringify(account, null, 2);
      try {
        parseAccount();
      } catch { /* 订阅仍可展示 */ }
    }
    if (yaml) {
      state.canonicalYaml = yaml;
      state.manualOverride = false;
    }
    render();
    status(announce ? "订阅内容已刷新。" : "已自动载入 Actions 发布的配置。");
  }

  bindEvents();
  loadPublishedConfig();
})();
