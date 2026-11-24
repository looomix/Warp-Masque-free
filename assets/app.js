(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const WARP_PEER = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";
  const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const pemBody = (value) => String(value || "").replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----/g, "").replace(/\s/g, "");
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const hexText = (text) => Array.from(new TextEncoder().encode(text)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };

  const state = { wg: null, masque: null, outputs: { conf: "", yaml: "", sub: "" }, tab: "conf" };

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 5000);
  }

  function status(message, error = false) {
    const el = $("#accountStatus");
    el.textContent = message;
    el.style.color = error ? "#fda4af" : "";
  }

  function workerBase() {
    return $("#workerUrl").value.trim().replace(/\/$/, "");
  }

  async function api(path, body) {
    const base = workerBase();
    if (!base) throw new Error("请先填写 Worker 地址，或点击“一键部署中继 Worker”");
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.message) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
  }

  async function genX25519() {
    const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    return {
      privateKey: bytesToB64(await crypto.subtle.exportKey("raw", pair.privateKey)),
      publicKey: bytesToB64(await crypto.subtle.exportKey("raw", pair.publicKey)),
    };
  }

  async function genP256() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    return {
      privateKey: bytesToB64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
      publicKey: bytesToB64(await crypto.subtle.exportKey("spki", pair.publicKey)),
    };
  }

  function serialNumber() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
    let s = [0, 0, 0, 0];
    let h = ["1", "2", "3", "4"];
    if (mode === "legacy") {
      jc = rand(3, 150);
      jmin = rand(20, 60);
      jmax = rand(700, 1000);
      s = [0, 0];
    }
    const lines = [];
    if (mode === "legacy") {
      lines.push(`S1 = ${s[0]}`, `S2 = ${s[1]}`, `Jc = ${jc}`, `Jmin = ${jmin}`, `Jmax = ${jmax}`);
    } else {
      lines.push(`Jc = ${jc}`, `Jmin = ${jmin}`, `Jmax = ${jmax}`);
      s.forEach((v, i) => lines.push(`S${i + 1} = ${v}`));
      lines.push(`I1 = ${i1Payload()}`);
    }
    h.forEach((v, i) => lines.push(`H${i + 1} = ${v}`));
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
    if (!state.wg) return "";
    const mode = $("#profile").value;
    const addresses = state.wg.addresses || {};
    const ipv4 = addresses.v4 || state.wg.ipv4 || "172.16.0.2";
    const ipv6 = addresses.v6 || state.wg.ipv6 || "";
    const endpoint = state.wg.endpoint || "engage.cloudflareclient.com";
    const lines = [
      "[Interface]",
      `PrivateKey = ${state.wg.privateKey}`,
      `Address = ${$("#ipv6").checked && ipv6 ? `${ipv4}, ${ipv6}` : ipv4}`,
      "DNS = 1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001",
      "MTU = 1280",
    ];
    lines.push(...awgFields(mode));
    lines.push(
      "",
      "[Peer]",
      `PublicKey = ${WARP_PEER}`,
      `AllowedIPs = ${$("#ipv6").checked && ipv6 ? "0.0.0.0/0, ::/0" : "0.0.0.0/0"}`,
      `Endpoint = ${endpoint}:${$("#wgPort").value}`,
      "PersistentKeepalive = 25",
      ""
    );
    return lines.join("\n");
  }

  function endpointNodes() {
    const wantV6 = $("#ipv6").checked;
    const mode = $("#endpointMode").value;
    const ports = $("#portMode").value === "random" ? [443, 500, 1701, 4500, 8095] : [Number($("#portMode").value)];
    let servers;
    if (mode === "v6") servers = wantV6 ? ["2606:4700:103::2", "2606:4700:104::2"] : [];
    else if (mode === "v4") servers = ["162.159.198.2", "162.159.199.2"];
    else {
      servers = ["162.159.198.2", "162.159.199.2"];
      if (wantV6) servers.push("2606:4700:103::2", "2606:4700:104::2");
    }
    if (!servers.length) throw new Error("请启用 IPv6 或更换 Endpoint 范围");
    const nodes = [];
    servers.forEach((server) => ports.forEach((port) => nodes.push({ server, port })));
    return nodes;
  }

  function rulesBlock() {
    if (!$("#rules").checked) return "";
    const base = "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite";
    const sets = ["private", "cn", "google", "youtube", "telegram", "github", "microsoft", "apple"];
    const providers = sets.map((n) => `  ${n}: {type: http, behavior: domain, format: mrs, url: "${base}/${n}.mrs", interval: 86400}`).join("\n");
    const rules = sets.map((n) => (n === "private" || n === "cn" ? `  - RULE-SET,${n},DIRECT` : `  - RULE-SET,${n},节点选择`)).join("\n");
    return `\nrule-providers:\n${providers}\n\nrules:\n${rules}\n  - MATCH,FINAL\n`;
  }

  function buildYaml() {
    if (!state.masque) return "";
    const nodes = endpointNodes();
    const network = $("#network").value;
    const networkLine = network === "h2" ? "\n    network: h2" : network === "h3-l4proxy" ? "\n    network: h3-l4proxy" : "";
    const ipv4 = state.masque.addresses.v4 || state.masque.ipv4 || "172.16.0.2";
    const ipv6 = state.masque.addresses.v6 || state.masque.ipv6 || "";
    const ipv6Line = $("#ipv6").checked && ipv6 ? `\n    ipv6: ${ipv6}` : "";
    const publicKey = pemBody(state.masque.publicKey);
    const proxies = nodes
      .map((n) => {
        const name = `官方 | ${n.server} | ${n.port} | WARP-MASQUE`;
        return `  - name: "${name}"\n    type: masque\n    server: ${n.server}\n    port: ${n.port}\n    private-key: ${state.masque.privateKey}\n    public-key: ${publicKey}\n    ip: ${ipv4}${ipv6Line}\n    uri: https://cloudflareaccess.com\n    mtu: 1280\n    udp: ${$("#udp").checked}\n    remote-dns-resolve: true\n    congestion-controller: ${$("#cc").value}\n    sni: ${$("#sni").value.trim() || "www.cloudflareaccess.com"}${networkLine}`;
      })
      .join("\n\n");
    const names = nodes.map((n) => `"官方 | ${n.server} | ${n.port} | WARP-MASQUE"`).join(", ");

    return window.MASQUE_TEMPLATE
      .replace("__TIME__", new Date().toLocaleString("zh-CN"))
      .replace("__VERSION__", "2.0.0")
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

  function localSub(yaml) {
    return `${location.origin}${location.pathname}#sub=${b64urlEncode(yaml)}`;
  }

  async function remoteSub(yaml) {
    if (!workerBase()) return null;
    try {
      const data = await api("/api/sub", { format: "clash", content: yaml, tier: "24h" });
      return data.url || null;
    } catch {
      return null;
    }
  }

  function render() {
    state.outputs.conf = buildConf();
    state.outputs.yaml = buildYaml();
    state.outputs.sub = state.outputs.yaml ? `${localSub(state.outputs.yaml)}\n\n（远程订阅地址在 Worker 可用时自动生成）` : "";
    $("#result").hidden = false;
    $("#resultMeta").textContent = `${$("#profile").value.toUpperCase()} · ${$("#network").value.toUpperCase()} · 本地组装`;
    showTab(state.tab);
  }

  function showTab(tab) {
    state.tab = tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    const text = state.outputs[tab] || "";
    $("#output").textContent = text || "尚未生成，请先注册或粘贴账号。";
    $("#copyOutput").disabled = !text;
    $("#downloadOutput").disabled = !text || tab === "sub";
  }

  async function oneClick() {
    try {
      status("正在生成 X25519 密钥并注册 WARP…");
      const wgKey = await genX25519();
      const registered = await api("/api/warp/register", {
        key: wgKey.publicKey,
        serial_number: serialNumber(),
        tos: new Date().toISOString(),
      });
      const peer = (registered.config && registered.config.peers && registered.config.peers[0]) || {};
      const addresses = (registered.config && registered.config.interface && registered.config.interface.addresses) || {};
      state.wg = {
        privateKey: wgKey.privateKey,
        addresses,
        ipv4: addresses.v4,
        ipv6: addresses.v6,
        endpoint: (peer.endpoint && peer.endpoint.host ? peer.endpoint.host.split(":")[0] : "engage.cloudflareclient.com"),
      };

      status("正在注册 MASQUE 设备…");
      const masqueKey = await genX25519();
      const masqueReg = await api("/api/warp/register", {
        key: masqueKey.publicKey,
        serial_number: serialNumber(),
        tos: new Date().toISOString(),
      });
      const p256 = await genP256();
      const enrolled = await api("/api/warp/enroll", {
        id: masqueReg.id,
        token: masqueReg.token,
        public_key: p256.publicKey,
        name: "WARP-MASQUE",
      });
      const mPeer = (enrolled.config && enrolled.config.peers && enrolled.config.peers[0]) || {};
      const mAddresses = (enrolled.config && enrolled.config.interface && enrolled.config.interface.addresses) || {};
      state.masque = {
        privateKey: p256.privateKey,
        publicKey: mPeer.public_key || p256.publicKey,
        addresses: mAddresses,
        ipv4: mAddresses.v4,
        ipv6: mAddresses.v6,
      };

      render();
      const remote = await remoteSub(state.outputs.yaml);
      if (remote) state.outputs.sub = `${remote}\n\n本地备用：\n${localSub(state.outputs.yaml)}`;
      if (state.tab === "sub") showTab("sub");
      status("注册成功，配置已生成。请妥善保存本页面输出的私钥。");
      toast("WARP 注册成功，配置已生成");
    } catch (error) {
      status(`失败：${error.message}`, true);
      toast(error.message);
    }
  }

  function parseManualAccount() {
    const raw = $("#accountText").value.trim();
    if (!raw) throw new Error("没有账号 JSON，请先一键注册或粘贴账号");
    const root = JSON.parse(raw);
    const account = root && root.success && root.content ? root.content : root;
    if (!account.private_key && !account.privateKey) throw new Error("账号缺少 private_key");
    const priv = account.private_key || account.privateKey;
    const addresses = {
      v4: account.ipv4 || account.address || "172.16.0.2",
      v6: account.ipv6 || "",
    };
    state.wg = {
      privateKey: pemBody(priv).length === 43 ? priv : pemBody(priv),
      addresses,
      ipv4: addresses.v4,
      ipv6: addresses.v6,
      endpoint: account.endpoint_v4 || account.endpoint || "engage.cloudflareclient.com",
    };
    state.masque = {
      privateKey: priv,
      publicKey: account.endpoint_pub_key || account.public_key || "",
      addresses,
      ipv4: addresses.v4,
      ipv6: addresses.v6,
    };
  }

  async function generate() {
    try {
      parseManualAccount();
      render();
      const remote = await remoteSub(state.outputs.yaml);
      if (remote) state.outputs.sub = `${remote}\n\n本地备用：\n${localSub(state.outputs.yaml)}`;
      if (state.tab === "sub") showTab("sub");
      toast("已从账号生成配置");
    } catch (error) {
      toast(error.message);
    }
  }

  async function checkWorker() {
    try {
      const base = workerBase();
      if (!base) throw new Error("请先填写 Worker 地址");
      const response = await fetch(`${base}/api/health`);
      const data = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      status(`中继连接正常：${data.service || "ok"}`);
      toast("Worker 连接正常");
    } catch (error) {
      status(`中继连接失败：${error.message}`, true);
      toast(`中继连接失败：${error.message}`);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      toast("已复制");
    }
  }

  function bindEvents() {
    $("#oneClick").addEventListener("click", oneClick);
    $("#generate").addEventListener("click", generate);
    $("#checkWorker").addEventListener("click", checkWorker);
    $("#copyOutput").addEventListener("click", () => copyText(state.outputs[state.tab] || ""));
    $("#downloadOutput").addEventListener("click", () => {
      const text = state.outputs[state.tab];
      if (!text) return;
      const ext = state.tab === "yaml" ? "yaml" : state.tab === "conf" ? "conf" : "txt";
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
          note: "示例结构，不能连接",
        },
        null,
        2
      );
      status("已填入示例结构（仅预览，不能连接）。");
    });
  }

  function restoreHash() {
    const match = location.hash.match(/^#sub=(.+)$/);
    if (!match) return;
    try {
      const yaml = b64urlDecode(match[1]);
      state.outputs.yaml = yaml;
      state.outputs.sub = location.href;
      $("#result").hidden = false;
      showTab("yaml");
      status("已从订阅链接恢复 YAML。");
    } catch {
      toast("订阅链接解析失败");
    }
  }

  bindEvents();
  restoreHash();
})();
