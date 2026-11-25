(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  /* ---------------------------------------------------------------- 仓库信息 */

  const FALLBACK = { owner: "looomix", repo: "Warp-Masque-free" };

  function repoInfo() {
    const match = /^([\w-]+)\.github\.io$/i.exec(location.hostname || "");
    if (match) {
      const segment = location.pathname.split("/").filter(Boolean)[0];
      return { owner: match[1], repo: segment || `${match[1]}.github.io` };
    }
    return FALLBACK;
  }

  const REPO = repoInfo();
  const PAGES_BASE = `https://${REPO.owner}.github.io/${REPO.repo}`;
  const RAW_BASE = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/main`;
  const SUB_URL = `${PAGES_BASE}/configs/warp-masque.yaml`;
  const MIRROR_URL = `https://gh-proxy.com/${RAW_BASE}/configs/warp-masque.yaml`;
  const IMPORT_URL = `clash://install-config?url=${encodeURIComponent(MIRROR_URL)}`;
  const ACTIONS_URL = `https://github.com/${REPO.owner}/${REPO.repo}/actions/workflows/generate-warp.yml`;
  const ROLLBACK_URL = `https://github.com/${REPO.owner}/${REPO.repo}/actions/workflows/rollback.yml`;
  const REPO_URL = `https://github.com/${REPO.owner}/${REPO.repo}`;

  const WARP_PEER = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";
  const TRACE_URL = "https://cloudflare.com/cdn-cgi/trace";
  const AUTO_CLEAR_MS = 60_000;
  const KERNEL_HINT = "MASQUE 出站需要 Mihomo Alpha 内核（>= 1.19.0-alpha），稳定版会报 unknown proxy type";

  const LS_ACCOUNT = "warpgen.hide.account.v1";
  const LS_ADDR = "warpgen.hide.addr.v1";

  const state = {
    account: null,
    canonicalYaml: "",
    manualOverride: false,
    viewLabel: "",
    outputs: { conf: "", yaml: "", singbox: "", links: "", sub: "" },
    tab: "yaml",
    health: null,
    meta: null,
    versions: [],
  };
  let clearTimer = null;
  let clearDeadline = 0;
  let started = false;

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const hexText = (text) => Array.from(new TextEncoder().encode(text)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const pemBody = (value) => String(value || "").replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----/g, "").replace(/\s/g, "");

  /* -------------------------------------------------------------- 本地记忆 --- */

  function flag(key) {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function setFlag(key, on) {
    try {
      if (on) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch { /* 隐私模式下忽略 */ }
  }

  /* -------------------------------------------------------------- 基础工具 --- */

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

  function fmtLocal(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  async function fetchText(path, timeout = 9000) {
    const targets = path.includes("://") ? [path] : [path, `${RAW_BASE}/${path}`];
    for (const target of targets) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const glue = target.includes("?") ? "&" : "?";
        const res = await fetch(`${target}${glue}t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        return await res.text();
      } catch { /* 换下一个来源 */ }
    }
    return null;
  }

  async function fetchJson(path) {
    const text = await fetchText(path);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------ 地址栏 / 清空逻辑 --- */

  function fillAddresses() {
    $("#subRemote").value = SUB_URL;
    $("#subMirror").value = MIRROR_URL;
    $("#clashImport").value = IMPORT_URL;
    ["#copyRemote", "#copyMirror", "#copyImport"].forEach((id) => { $(id).disabled = false; });
  }

  function blankAddresses() {
    ["#subRemote", "#subMirror", "#clashImport"].forEach((id) => { $(id).value = ""; });
    ["#copyRemote", "#copyMirror", "#copyImport"].forEach((id) => { $(id).disabled = true; });
  }

  function restoreAddresses() {
    setFlag(LS_ADDR, false);
    fillAddresses();
    toast("订阅地址已恢复");
    status("订阅地址已恢复；账号 JSON 仍保持清空状态，点“刷新订阅内容”可重新载入已发布配置。");
  }

  function stopAutoClear() {
    clearTimeout(clearTimer);
    clearTimer = null;
    clearDeadline = 0;
  }

  /**
   * 清空生成信息。
   * manual = true：连同三条订阅地址一起清空，并写入 localStorage 标记，
   *                下次打开页面保持空白（这正是旧版本缺失的一步）。
   * manual = false：仅清空含私钥的账号 JSON 与输出区（60 秒自动清空用）。
   */
  function clearGeneratedContent(manual = false) {
    stopAutoClear();
    state.account = null;
    state.canonicalYaml = "";
    state.manualOverride = false;
    state.viewLabel = "";
    state.outputs = { conf: "", yaml: "", singbox: "", links: "", sub: "" };
    $("#accountText").value = "";
    $("#result").hidden = true;
    $("#output").textContent = "";

    if (manual) {
      setFlag(LS_ACCOUNT, true);
      setFlag(LS_ADDR, true);
      blankAddresses();
      status("已清空账号 JSON 与三条订阅地址，并记住该操作：下次打开页面不会再自动载入。点“恢复订阅地址”或“刷新订阅内容”可重新载入。");
    } else {
      status("页面敏感内容已自动清空（账号 JSON 与输出），订阅地址保留。需要时请重新生成或刷新订阅。");
    }
  }

  function isCleared() {
    return flag(LS_ACCOUNT);
  }

  function scheduleAutoClear() {
    stopAutoClear();
    clearDeadline = Date.now() + AUTO_CLEAR_MS;
    clearTimer = setTimeout(() => clearGeneratedContent(false), AUTO_CLEAR_MS);
  }

  function enforceAutoClear() {
    if (clearDeadline && Date.now() >= clearDeadline) clearGeneratedContent(false);
  }

  /* ------------------------------------------------------------ 配置生成 --- */

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
      lines.push("S1 = 0", "S2 = 0");
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

  function blockedText(format) {
    const reason = (state.meta && state.meta.blockedFormatReason) ||
      "当前账号是 MASQUE（EC P-256）密钥，标准 WireGuard .conf / sing-box 需要 32 字节 X25519 私钥，无法直接转换。";
    return `无法导出 ${format}\n\n${reason}\n\n可选做法：\n1. 用 wgcf 注册一个 WARP 账号，把 config.json 粘贴到上方输入框，即可导出 .conf 与 sing-box 配置；\n2. 继续使用 Clash / Mihomo 的 MASQUE 订阅（本页“Clash YAML”标签）；\n3. 需要 AmneziaWG 伪装时，用 wgcf 账号 + 上方 AWG 档位生成。`;
  }

  function buildConf() {
    const a = state.account;
    if (!a || !a.wgPrivate) return blockedText("标准 WireGuard .conf");
    const mode = $("#profile").value;
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

  function nodeList() {
    const wantV6 = $("#ipv6").checked;
    const mode = $("#endpointMode").value;
    const ports = $("#portMode").value === "random" ? [443, 4443, 8443, 8095] : [Number($("#portMode").value)];
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

  function latencyOf(node) {
    const nodes = state.health && state.health.nodes;
    if (!Array.isArray(nodes)) return null;
    const hit = nodes.find((n) => n.server === node.server && n.port === node.port);
    return hit && hit.ok && typeof hit.latencyMs === "number" ? hit.latencyMs : null;
  }

  function orderedNodes() {
    const list = nodeList();
    if (!$("#sortByLatency").checked || !state.health || !Array.isArray(state.health.nodes)) return list;
    return [...list].sort((a, b) => {
      const la = latencyOf(a);
      const lb = latencyOf(b);
      if (la === null && lb === null) return 0;
      if (la === null) return 1;
      if (lb === null) return -1;
      return la - lb;
    });
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
    const nodes = orderedNodes();
    const network = $("#network").value;
    const networkLine = network === "h2" ? "\n    network: h2" : network === "h3-l4proxy" ? "\n    network: h3-l4proxy" : "";
    const ipv6Line = $("#ipv6").checked && a.ipv6 ? `\n    ipv6: ${a.ipv6}` : "";
    const proxies = nodes
      .map((n) => {
        const latency = latencyOf(n);
        const name = `WARP | ${n.server} | ${n.port}`;
        return `  # 延迟 ${latency === null ? "未测速" : `${latency}ms`}\n  - name: "${name}"\n    type: masque\n    server: ${n.server}\n    port: ${n.port}\n    private-key: ${a.privateKey}\n    public-key: ${pemBody(a.publicKey)}\n    ip: ${a.ipv4}${ipv6Line}\n    uri: https://cloudflareaccess.com\n    mtu: 1280\n    udp: ${$("#udp").checked}\n    remote-dns-resolve: true\n    congestion-controller: ${$("#cc").value}\n    dns: [ 1.1.1.1, 8.8.8.8 ]\n    sni: ${$("#sni").value.trim() || "www.cloudflareaccess.com"}${networkLine}`;
      })
      .join("\n\n");
    const names = nodes.map((n) => `"WARP | ${n.server} | ${n.port}"`).join(", ");

    return window.MASQUE_TEMPLATE
      .replace("__TIME__", new Date().toLocaleString("zh-CN"))
      .replace("__VERSION__", "3.1.0-actions")
      .replace(/__IPV6__/g, $("#ipv6").checked ? "true" : "false")
      .replace("__DNS_IPV6__", $("#ipv6").checked ? "true" : "false")
      .replace("__DNS_MODE__", "fake-ip")
      .replace("__PROXIES__", proxies)
      .replace(/__PROXY_NAMES__/g, `[${names}]`)
      .replace("__OFFICIAL_NAMES__", `[${names}]`)
      .replace(/__TEST_URL__/g, $("#testUrl").value.trim() || TRACE_URL)
      .replace(/__TEST_INTERVAL__/g, "300")
      .replace(/__TEST_TOLERANCE__/g, "30")
      .replace("__RULES_BLOCK__", rulesBlock());
  }

  function buildSingbox() {
    const a = state.account;
    if (!a || !a.wgPrivate) return blockedText("sing-box 配置");
    const local = [`${a.ipv4}/32`].concat($("#ipv6").checked && a.ipv6 ? [`${a.ipv6}/128`] : []);
    const allowed = ["0.0.0.0/0"].concat($("#ipv6").checked && a.ipv6 ? ["::/0"] : []);
    const nodes = orderedNodes();
    const names = nodes.map((n) => `WARP | ${n.server} | ${n.port}`);
    const endpoints = nodes.map((n, i) => ({
      type: "wireguard",
      tag: names[i],
      system: false,
      mtu: 1280,
      address: local,
      private_key: a.wgPrivate,
      udp_timeout: "5m",
      peers: [{
        address: n.server,
        port: n.port,
        public_key: WARP_PEER,
        allowed_ips: allowed,
        persistent_keepalive_interval: 25,
      }],
    }));
    const config = {
      _comment: "由 Warp-Masque free 页面生成；含私钥，请当作凭据保管；需要 sing-box >= 1.13",
      _generatedAt: new Date().toLocaleString("zh-CN"),
      log: { level: "info", timestamp: true },
      dns: {
        servers: [
          { tag: "proxy-dns", address: "https://1.1.1.1/dns-query", detour: "节点选择" },
          { tag: "local-dns", address: "223.5.5.5", detour: "direct" },
        ],
        rules: [{ rule_set: "geosite-cn", server: "local-dns" }],
        final: "proxy-dns",
      },
      inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 7890 }],
      endpoints,
      outbounds: [
        { type: "selector", tag: "节点选择", outbounds: ["自动选择", "手动切换", "direct"], default: "自动选择" },
        { type: "urltest", tag: "自动选择", outbounds: names, url: $("#testUrl").value.trim() || TRACE_URL, interval: "5m", tolerance: 50, idle_timeout: "30m" },
        { type: "selector", tag: "手动切换", outbounds: names, default: names[0] },
        { type: "direct", tag: "direct" },
      ],
      route: {
        rules: [{ rule_set: "geosite-cn", outbound: "direct" }],
        rule_set: [{
          tag: "geosite-cn",
          type: "remote",
          format: "binary",
          url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/cn.mrs",
          download_detour: "direct",
        }],
        final: "节点选择",
        auto_detect_interface: true,
      },
    };
    return JSON.stringify(config, null, 2);
  }

  function buildLinks() {
    const a = state.account;
    if (!a || !a.privateKey || !a.publicKey) return "当前账号缺少 MASQUE 密钥，无法生成 masque:// 分享链接。";
    const sni = $("#sni").value.trim() || "www.cloudflareaccess.com";
    const publicKey = pemBody(a.publicKey);
    const lines = orderedNodes().map((n) => {
      const name = `WARP | ${n.server} | ${n.port}`;
      const params = [
        `publicKey=${encodeURIComponent(publicKey)}`,
        `privateKey=${encodeURIComponent(a.privateKey)}`,
        `ip=${encodeURIComponent(a.ipv4)}`,
        "dns=1.1.1.1",
        "udp=1",
        `cc=${$("#cc").value}`,
        `sni=${encodeURIComponent(sni)}`,
      ].join("&");
      const host = n.server.includes(":") ? `[${n.server}]` : n.server;
      return `masque://${host}:${n.port}?${params}#${encodeURIComponent(name)}`;
    });
    return lines.join("\n") + "\n";
  }

  function showTab(tab) {
    state.tab = tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $("#output").textContent = state.outputs[tab] || "尚未生成，请先粘贴账号 JSON。";
    $("#copyOutput").disabled = !state.outputs[tab];
    $("#downloadOutput").disabled = tab === "sub" || !state.outputs[tab];
  }

  function render() {
    state.outputs.conf = buildConf();
    state.outputs.yaml = state.manualOverride || !state.canonicalYaml ? buildYaml() : state.canonicalYaml;
    state.outputs.singbox = buildSingbox();
    state.outputs.links = buildLinks();
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
    $("#resultMeta").textContent = state.viewLabel
      ? `查看历史版本 ${state.viewLabel}（只读预览，回滚请点“回滚”）`
      : `${$("#profile").value.toUpperCase()} · ${$("#network").value.toUpperCase()} · 本地转换`;
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
      wgPrivate: x25519(privateKey),
      ipv4,
      ipv6,
      endpoint: account.endpoint_v4 || account.endpoint || "engage.cloudflareclient.com",
    };
  }

  function x25519(value) {
    const text = String(value || "").trim();
    if (!/^[A-Za-z0-9+/]{43}=?$/.test(text)) return "";
    try {
      return atob(text).length === 32 ? text : "";
    } catch {
      return "";
    }
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

  /* --------------------------------------------------------------- 状态栏 --- */

  function cronText(cron) {
    if (!cron) return "—";
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;
    const hour = parts[1];
    if (hour.startsWith("*/")) return `每 ${hour.slice(2)} 小时`;
    if (hour === "*") return "每小时";
    return `每天 ${String(hour).padStart(2, "0")}:${String(parts[0]).padStart(2, "0")} (UTC)`;
  }

  function tickCountdown() {
    const el = $("#statCountdown");
    const next = state.meta && state.meta.nextRunAt ? new Date(state.meta.nextRunAt).getTime() : NaN;
    if (Number.isNaN(next)) {
      el.textContent = "—";
      return;
    }
    const diff = next - Date.now();
    if (diff <= 0) {
      el.textContent = "即将触发";
      return;
    }
    const hours = Math.floor(diff / 3.6e6);
    const minutes = Math.floor((diff % 3.6e6) / 6e4);
    el.textContent = `${hours} 小时 ${minutes} 分后`;
  }

  function renderMeta() {
    const meta = state.meta;
    if (!meta) {
      $("#statLast").textContent = "未读取到 meta.json";
      $("#statNext").textContent = "运行一次 Actions 后可见";
      return;
    }
    const lastText = fmtLocal(meta.generatedAt) || meta.generatedAtLocal || "—";
    $("#statLast").textContent = meta.rolledBackTo
      ? `${lastText}（回滚至 ${meta.rolledBackTo}）`
      : lastText;
    $("#statNext").textContent = meta.nextRunAt ? fmtLocal(meta.nextRunAt) : "未设置定时";
    $("#statNodes").textContent = `${meta.nodes ?? "—"} / ${meta.probed ? (meta.healthy ?? 0) : "未测速"}`;
    $("#statCron").textContent = cronText(meta.cron);
    tickCountdown();
  }

  async function loadMeta() {
    renderMeta();
    const meta = await fetchJson("configs/meta.json");
    if (meta && typeof meta === "object") {
      state.meta = meta;
    }
    renderMeta();
  }

  /* --------------------------------------------------------------- 健康度 --- */

  function renderHealth() {
    const health = state.health;
    const table = $("#healthTable");
    const hints = $("#healthHints");
    if (!health) {
      table.innerHTML = "";
      hints.innerHTML = '<p class="hint">尚未读取到 <code>configs/health.json</code>，运行一次 Actions 后会生成。</p>';
      return;
    }
    if (health.skipped) {
      table.innerHTML = "";
      hints.innerHTML = '<p class="hint">最近一次生成跳过了测速（--no-probe），节点按默认顺序发布。</p>';
      return;
    }
    const rows = (health.nodes || []).slice(0, 20).map((n) => {
      let cls = "fail";
      let label = "失败";
      if (n.ok && n.kept !== false) {
        cls = "ok";
        label = "可达";
      } else if (n.ok) {
        cls = "warn";
        label = "超阈值";
      }
      return `<tr><td><code>${n.server}</code></td><td>${n.port}</td><td><span class="badge ${cls}">${label}</span></td><td>${n.ok && n.latencyMs != null ? n.latencyMs + " ms" : "—"}</td><td>${n.method || "—"}</td><td>${n.error ? `<span class="err">${n.error}</span>` : "—"}</td></tr>`;
    }).join("");
    table.innerHTML = `
      <div class="table-head">
        <b>端点测速</b>
        <span>${fmtLocal(health.checkedAt)} · 健康 ${health.healthy}/${health.total} · 剔除 ${health.dropped} · 阈值 ${health.maxLatency}ms</span>
      </div>
      <table class="data-table">
        <thead><tr><th>端点</th><th>端口</th><th>结果</th><th>延迟</th><th>方式</th><th>错误</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    const hintList = (health.hints || []).map((h) => `<li>${h}</li>`).join("");
    hints.innerHTML = hintList ? `<div class="hint-block-in"><b>排查提示</b><ul>${hintList}</ul></div>` : "";
  }

  function checkRow(kind, title, detail) {
    const icon = kind === "ok" ? "✓" : kind === "warn" ? "!" : "×";
    return `<div class="check-row ${kind}"><span class="dot">${icon}</span><div><b>${title}</b><p>${detail}</p></div></div>`;
  }

  async function runCheck() {
    const box = $("#checkResult");
    $("#checkMeta").textContent = "检测中…";
    box.innerHTML = checkRow("warn", "正在检测…", "订阅文件、账号文件、测速报告、本机直连");
    const rows = [];
    const hints = [];

    const begun = performance.now();
    const yaml = await fetchText("configs/warp-masque.yaml", 8000);
    const cost = Math.round(performance.now() - begun);
    if (yaml) {
      const nodes = (yaml.match(/type:\s*masque/g) || []).length;
      rows.push(checkRow("ok", "订阅文件可访问", `${SUB_URL} · ${cost}ms · ${nodes} 个 masque 节点 · ${Math.round(yaml.length / 1024)} KB`));
    } else {
      rows.push(checkRow("fail", "订阅文件读取失败", `无法读取 ${SUB_URL}，可能是 Actions 尚未提交（commit 未开启）或 Pages 未构建。`));
      hints.push("确认工作流运行时勾选了 commit，且 Settings → Pages 指向 main 分支根目录。");
    }

    if (isCleared()) {
      rows.push(checkRow("warn", "账号文件已按你的操作跳过", "你点过“一键清空”，页面不会请求 configs/usque-config.json。点“刷新订阅内容”可重新载入。"));
    } else {
      const account = await fetchJson("configs/usque-config.json");
      rows.push(account
        ? checkRow("ok", "账号文件已发布", "已读取 configs/usque-config.json（含私钥，注意仓库可见性）。")
        : checkRow("warn", "账号文件未公开", "仓库里没有可读取的 configs/usque-config.json，页面只能用粘贴的账号生成本地配置。"));
    }

    const health = state.health;
    if (health && !health.skipped) {
      const kind = health.healthy > 0 ? "ok" : "fail";
      const portText = (health.ports || []).map((p) => `${p.port}: ${p.ok}/${p.ok + p.fail}`).join("，");
      rows.push(checkRow(kind, `端点测速 ${health.healthy}/${health.total} 可达`,
        `${fmtLocal(health.checkedAt)} 由 Runner 探测 · 端口成功/总数 ${portText || "—"}`));
      (health.hints || []).forEach((h) => hints.push(h));
    } else {
      rows.push(checkRow("warn", "没有测速报告", "configs/health.json 缺失或本次生成跳过了测速。"));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      await fetch(`${TRACE_URL}?t=${Date.now()}`, { mode: "no-cors", cache: "no-store", signal: controller.signal });
      clearTimeout(timer);
      rows.push(checkRow("ok", "本机可直连 Cloudflare", `已向 ${TRACE_URL} 发起实际请求（no-cors，仅判断网络可达性）。`));
    } catch {
      rows.push(checkRow("fail", "本机直连 Cloudflare 失败", "请检查本机网络、DNS 或系统代理；若已开启代理，先关闭再测。"));
      hints.push("本机都无法直连 Cloudflare 时，导入订阅后大概率也连不上，请先排查本地网络。");
    }

    rows.push(checkRow("warn", "内核要求", KERNEL_HINT));
    if (state.account && !state.account.wgPrivate) {
      rows.push(checkRow("warn", "当前账号只支持 MASQUE", "该账号是 EC P-256 密钥，无法导出标准 WireGuard .conf / sing-box，属正常现象。"));
    }

    box.innerHTML = rows.join("");
    $("#checkMeta").textContent = `上次自检：${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
    if (hints.length) {
      $("#healthHints").innerHTML = `<div class="hint-block-in"><b>排查提示</b><ul>${hints.map((h) => `<li>${h}</li>`).join("")}</ul></div>`;
    }
  }

  /* --------------------------------------------------------------- 版本列表 --- */

  function renderVersions() {
    const box = $("#historyList");
    if (!state.versions.length) {
      box.innerHTML = '<p class="hint">尚未读取到版本列表。运行一次 Actions（开启 commit）后即可在这里看到快照。</p>';
      return;
    }
    box.innerHTML = state.versions.map((v, index) => {
      const best = v.bestLatencyMs != null ? `${v.bestLatencyMs}ms` : "未测速";
      return `<div class="vrow">
        <div class="vmain">
          <b>${v.version}</b>
          <span class="vtag">${index === 0 ? "最新" : `-${index}`}</span>
          <p>${fmtLocal(v.createdAt) || v.createdAtLocal || "—"} · ${v.nodes ?? "?"} 个节点 · 健康 ${v.healthy ?? "?"} · 最优 ${best}${v.bestEndpoint ? ` (${v.bestEndpoint})` : ""}</p>
        </div>
        <div class="vactions">
          <button type="button" class="btn btn-mini" data-view="${v.version}">查看</button>
          <button type="button" class="btn btn-mini" data-download="${v.version}">下载</button>
          <button type="button" class="btn btn-mini btn-primary" data-rollback="${v.version}">回滚</button>
        </div>
      </div>`;
    }).join("");

    box.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => viewVersion(btn.dataset.view)));
    box.querySelectorAll("[data-download]").forEach((btn) => btn.addEventListener("click", () => downloadVersion(btn.dataset.download)));
    box.querySelectorAll("[data-rollback]").forEach((btn) => btn.addEventListener("click", () => rollbackVersion(btn.dataset.rollback)));
  }

  async function loadVersions() {
    const index = await fetchJson("configs/history/index.json");
    if (index && Array.isArray(index.versions)) {
      state.versions = index.versions;
      renderVersions();
    }
  }

  async function viewVersion(version) {
    const text = await fetchText(`configs/history/warp-masque-${version}.yaml`, 12000);
    if (!text) {
      toast("读取该版本失败");
      return;
    }
    state.canonicalYaml = text;
    state.manualOverride = false;
    state.viewLabel = version;
    state.tab = "yaml";
    render();
    $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
    toast(`已载入历史版本 ${version}`);
  }

  async function downloadVersion(version) {
    const text = await fetchText(`configs/history/warp-masque-${version}.yaml`, 12000);
    if (!text) {
      toast("下载失败");
      return;
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warp-masque-${version}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function rollbackVersion(version) {
    await copyText(version, `版本号 ${version} 已复制`);
    window.open(ROLLBACK_URL, "_blank", "noopener");
    toast("已复制版本号并打开回滚工作流，粘贴后运行即可");
  }

  /* --------------------------------------------------------------- 事件绑定 --- */

  function bindEvents() {
    $("#generate").addEventListener("click", () => {
      try {
        parseAccount();
        state.manualOverride = true;
        state.viewLabel = "";
        render();
        status("已从账号 JSON 本地生成配置（本地预览）；页面敏感内容将在 60 秒后自动清空。");
        scheduleAutoClear();
        toast("配置已生成");
      } catch (error) {
        toast(error.message);
      }
    });
    $("#reloadSub").addEventListener("click", () => {
      setFlag(LS_ACCOUNT, false);
      setFlag(LS_ADDR, false);
      fillAddresses();
      loadPublishedConfig(true);
    });
    $("#clearNow").addEventListener("click", () => {
      clearGeneratedContent(true);
      toast("已清空并记住，下次打开保持空白");
    });
    $("#restoreSub").addEventListener("click", restoreAddresses);
    $("#copyRemote").addEventListener("click", () => copyText(SUB_URL, "订阅地址已复制"));
    $("#copyMirror").addEventListener("click", () => copyText(MIRROR_URL, "镜像地址已复制"));
    $("#copyImport").addEventListener("click", () => copyText(IMPORT_URL, "导入链接已复制"));
    $("#copyOutput").addEventListener("click", () => copyText(state.outputs[state.tab] || ""));
    $("#downloadOutput").addEventListener("click", () => {
      const map = { conf: "conf", yaml: "yaml", singbox: "json", links: "txt" };
      const text = state.outputs[state.tab];
      const ext = map[state.tab];
      if (!text || !ext) return;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `warp-masque.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    });
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
    $("#runCheck").addEventListener("click", runCheck);
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
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) enforceAutoClear();
    });
  }

  /* ------------------------------------------------------------- 载入已发布 --- */

  async function loadPublishedConfig(announce = false) {
    if (isCleared()) {
      status(flag(LS_ADDR)
        ? "已按上次“一键清空”保持空白：账号 JSON 与订阅地址都不会自动载入。点“刷新订阅内容”可重新载入。"
        : "账号 JSON 已按上次“一键清空”保持空白（订阅地址已恢复）。点“刷新订阅内容”可重新载入已发布配置。");
      return;
    }
    status("正在读取已发布的配置…");
    let account = null;
    let yaml = null;
    const stamp = Date.now();
    try {
      const res = await fetch(`configs/usque-config.json?t=${stamp}`, { cache: "no-store" });
      if (res.ok) account = await res.json();
    } catch { /* 账号文件可能未公开 */ }
    try {
      const res = await fetch(`configs/warp-masque.yaml?t=${stamp}`, { cache: "no-store" });
      if (res.ok) yaml = await res.text();
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
      state.viewLabel = "";
    }
    render();
    status(`${announce ? "订阅内容已刷新" : "已自动载入 Actions 发布的配置"}；页面敏感内容将在 60 秒后自动清空（订阅地址保留）。`);
    scheduleAutoClear();
  }

  async function loadHealth() {
    const health = await fetchJson("configs/health.json");
    if (health && typeof health === "object") {
      state.health = health;
      renderHealth();
    }
  }

  /* ------------------------------------------------------------------ 启动 --- */

  function init() {
    if (started) return;
    started = true;

    $("#repoLink").href = REPO_URL;
    $("#actionsLink").href = ACTIONS_URL;
    const faq = $("#faqSubUrl");
    if (faq) faq.innerHTML = `Actions 生成的订阅地址是 <code>${SUB_URL}</code>，可直接填入 Clash / Mihomo（需要 Alpha 内核支持 masque）。每次重新运行工作流都会替换成全新账号。`;

    if (flag(LS_ADDR)) blankAddresses();
    else fillAddresses();

    bindEvents();
    setInterval(enforceAutoClear, 2000);
    setInterval(tickCountdown, 30000);

    loadMeta();
    loadHealth();
    loadVersions();
    loadPublishedConfig();
    setInterval(() => { loadMeta(); loadHealth(); }, 10 * 60_000);
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
