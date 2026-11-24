(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const WARP_PEER = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";
  const HISTORY_KEY = "awg_static_history_v1";
  const PRESETS = {
    youtube: { v4: ["142.250.0.0/15", "172.217.0.0/16", "216.58.0.0/16", "74.125.0.0/16"], v6: ["2607:f8b0::/32"] },
    google: { v4: ["8.8.8.8/32", "8.8.4.4/32", "142.250.0.0/15", "172.217.0.0/16"], v6: ["2001:4860:4860::/48"] },
    meta: { v4: ["31.13.64.0/18", "157.240.0.0/16", "179.60.192.0/22"], v6: ["2a03:2880::/32"] },
    discord: { v4: ["162.159.128.0/19", "104.16.0.0/12"], v6: ["2606:4700::/32"] },
    telegram: { v4: ["149.154.160.0/20", "91.108.4.0/22", "91.108.8.0/21"], v6: ["2001:67c:4e8::/48"] },
    github: { v4: ["140.82.112.0/20", "192.30.252.0/22", "185.199.108.0/22"], v6: ["2606:50c0::/32"] },
  };
  const DNS = {
    cloudflare: "1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001",
    google: "8.8.8.8, 8.8.4.4, 2001:4860:4860::8888, 2001:4860:4860::8844",
    quad9: "9.9.9.9, 149.112.112.112, 2620:fe::fe",
  };

  const state = {
    x25519: false,
    credential: null,
    current: null,
    currentText: "",
    previewText: "",
    history: [],
  };

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const hex = (text) => Array.from(new TextEncoder().encode(text)).map((b) => b.toString(16).padStart(2, "0")).join("");

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function setCredential(cred, message) {
    state.credential = cred;
    const box = $("#credStatus");
    box.hidden = false;
    box.classList.toggle("error", !cred);
    if (cred) {
      box.textContent = message || `已载入密钥：${cred.privateKey.slice(0, 8)}…（${cred.source}）`;
    } else {
      box.textContent = message || "未能识别密钥。";
    }
  }

  async function detectEnvironment() {
    $("#envJs").textContent = "可用";
    try {
      const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
      await crypto.subtle.exportKey("raw", pair.privateKey);
      state.x25519 = true;
      $("#envCrypto").textContent = "支持 X25519";
    } catch {
      state.x25519 = false;
      $("#envCrypto").textContent = "不支持（可手动填私钥）";
    }
    try {
      localStorage.setItem("__awg_test", "1");
      localStorage.removeItem("__awg_test");
      $("#envStorage").textContent = "可用";
    } catch {
      $("#envStorage").textContent = "不可用";
    }
    $("#envNet").textContent = navigator.onLine ? "在线（无后端请求）" : "离线（仍可生成）";
    window.addEventListener("online", () => ($("#envNet").textContent = "在线（无后端请求）"));
    window.addEventListener("offline", () => ($("#envNet").textContent = "离线（仍可生成）"));
  }

  function parseCredentialText(text) {
    const raw = text.trim();
    if (!raw) throw new Error("内容为空");
    let privateKey = null;
    let address = null;
    let publicKey = null;

    if (raw.startsWith("{")) {
      const obj = JSON.parse(raw);
      privateKey = obj.private_key || obj.privateKey || obj.PrivateKey || null;
      address = obj.address || obj.Address || null;
      publicKey = obj.public_key || obj.PublicKey || null;
      if (!privateKey && typeof obj.config === "string") {
        const decoded = obj.config.includes("=") === false ? obj.config : atob(obj.config);
        return parseCredentialText(decoded);
      }
    } else {
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z]+)\s*=\s*(.+?)\s*$/);
        if (!m) continue;
        const key = m[1].toLowerCase();
        if (key === "privatekey") privateKey = m[2];
        if (key === "address") address = m[2];
        if (key === "publickey" && !publicKey) publicKey = m[2];
      }
    }

    if (!privateKey || !/^[A-Za-z0-9+/]{43}=$/.test(privateKey)) {
      throw new Error("未找到有效的 32 字节 base64 PrivateKey");
    }
    return {
      privateKey,
      address: address || "172.16.0.2/32",
      peer: publicKey || WARP_PEER,
      source: "WARP 账户 / 配置",
    };
  }

  function currentCredential() {
    if ($("#credMode").value === "own") {
      const priv = $("#ownPriv").value.trim();
      if (!/^[A-Za-z0-9+/]{43}=$/.test(priv)) throw new Error("请先填入或生成有效的 PrivateKey");
      return {
        privateKey: priv,
        address: $("#ownAddr").value.trim() || "10.0.0.2/32",
        peer: $("#ownPeer").value.trim() || WARP_PEER,
        source: "自建服务器",
      };
    }
    if (!state.credential) throw new Error("请先粘贴并解析 WARP 密钥");
    return state.credential;
  }

  function buildI1(kind) {
    const branch = "z" + Math.random().toString(36).slice(2, 12);
    const tag = String(rand(10000000, 99999999));
    const cseq = String(rand(100000, 999999));
    const choices = {
      sip: `INVITE sip:bob@box.im SIP/2.0\r\nVia: SIP/2.0/UDP pc33.atlanta.com;branch=${branch}\r\nMax-Forwards: 70\r\nTo: Bob <sip:bob@box.im>\r\nFrom: Alice <sip:alice@atlanta.com>;tag=${tag}\r\nCall-ID: ${tag}@pc33.atlanta.com\r\nCSeq: ${cseq} INVITE\r\nContact: <sip:alice@pc33.atlanta.com>\r\nContent-Type: application/sdp\r\nContent-Length: 0\r\n\r\n`,
      quic: `GET /trimmed HTTP/3\r\n:authority: www.cloudflare.com\r\nuser-agent: Mozilla/5.0\r\nqpack: ${branch}\r\n\r\n`,
      dns: `;; QUESTION SECTION:\n${branch}. IN A\n;; ANSWER SECTION:\n${branch}. 300 IN A 104.16.${rand(0, 255)}.${rand(1, 254)}\n`,
      stun: `STUN Binding Request ${branch} ${tag}\n`,
      dtls: `DTLS ClientHello record ${branch} ${tag}\n`,
      static: `AWG mask ${tag} ${branch}\n`,
    };
    const resolved = choices[kind] || choices.sip;
    const chain = $("#i1Hex").value.trim();
    return `<b 0x${chain ? chain.replace(/^0x/i, "") : hex(resolved)}>`;
  }

  function obfuscation(mode, warpSafe) {
    let jc = rand(3, 24);
    let jmin = rand(64, 700);
    let jmax = rand(Math.max(jmin + 64, 128), 1024);
    let s = [0, 0, 0, 0];
    let h = ["1", "2", "3", "4"];

    if (mode === "legacy") {
      jc = rand(3, 150);
      jmin = rand(20, 60);
      jmax = rand(700, 1000);
      if (!warpSafe) s = [rand(0, 4), rand(0, 4), 0, 0];
    }

    const device = $("#device").value;
    if (device === "router") {
      jc = Math.min(jc, 2);
      jmin = Math.max(40, Math.min(jmin, 64));
      jmax = Math.min(Math.max(jmax, jmin + 32), 128);
    } else if (device === "mobile") {
      jc = 3;
      jmin = 64;
      jmax = 128;
    }

    const jcOverride = Number($("#jcOverride").value);
    const jminOverride = Number($("#jminOverride").value);
    const jmaxOverride = Number($("#jmaxOverride").value);
    if (jcOverride >= 1 && jcOverride <= 150) jc = jcOverride;
    if (jminOverride >= 20 && jminOverride <= 1024) jmin = jminOverride;
    if (jmaxOverride >= 20 && jmaxOverride <= 1024) jmax = Math.max(jminOverride || jmin, jmaxOverride);

    if (!warpSafe && mode !== "legacy") {
      const bands = [5, 536870911, 1073741817, 1610612723];
      h = bands.map((start, i) => {
        const end = i === 3 ? 2147483647 : bands[i + 1] - 1;
        return `${rand(start, end)}-${end}`;
      });
      s = [rand(0, 64), rand(0, 64), rand(0, 64), rand(0, 32)];
    }

    return { jc, jmin, jmax, s, h };
  }

  function allowedIps() {
    if ($('input[name="routeMode"]:checked').value === "full") {
      return $("#ipv6").checked ? "0.0.0.0/0, ::/0" : "0.0.0.0/0";
    }
    const selected = $$('input[name="route"]:checked').map((el) => el.value);
    if (!selected.length) throw new Error("分流模式请至少选择一个预设，或切换为全隧道");
    const v4 = [];
    const v6 = [];
    selected.forEach((id) => {
      if (PRESETS[id]) {
        v4.push(...PRESETS[id].v4);
        v6.push(...PRESETS[id].v6);
      }
    });
    if (v4.length > 1000) throw new Error("IPv4 网段超过 1000 条，请减少预设");
    return $("#ipv6").checked ? [...new Set(v4), ...new Set(v6)].join(", ") : [...new Set(v4)].join(", ");
  }

  function buildConfig(mode, cred, warpSafe) {
    const obf = obfuscation(mode, warpSafe);
    const cps = $("#cps").value;
    const dnsMode = $("#dns").value;
    const dns = dnsMode === "custom" ? $("#dnsCustom").value.trim() || "1.1.1.1" : DNS[dnsMode] || DNS.cloudflare;
    let host = $("#endpoint").value;
    if (host === "custom") host = $("#endpointCustom").value.trim();
    if (!host) throw new Error("请填写自定义 Endpoint");
    const port = $("#port").value;
    const device = $("#device").value;
    const ipv6Off = device === "mobile";
    const address = ipv6Off ? cred.address.split(",")[0].trim() : cred.address;
    const keepalive = mode === "awg3" || mode === "awg31" ? "25-35" : "25";

    const lines = ["[Interface]", `PrivateKey = ${cred.privateKey}`, `Address = ${address}`, `DNS = ${dns}`];

    if (mode === "legacy") {
      lines.push(`MTU = 1280`, `S1 = ${obf.s[0]}`, `S2 = ${obf.s[1]}`, `Jc = ${obf.jc}`, `Jmin = ${obf.jmin}`, `Jmax = ${obf.jmax}`);
      obf.h.forEach((value, i) => lines.push(`H${i + 1} = ${value}`));
      if (cps !== "auto") lines.push(`I1 = ${buildI1(cps)}`);
    } else if (mode === "awg2") {
      lines.push(`Jc = ${obf.jc}`, `Jmin = ${obf.jmin}`, `Jmax = ${obf.jmax}`);
      obf.s.forEach((value, i) => lines.push(`S${i + 1} = ${value}`));
      obf.h.forEach((value, i) => lines.push(`H${i + 1} = ${value}`));
      lines.push(`I1 = ${buildI1(cps === "auto" ? "sip" : cps)}`);
      lines.push(`MTU = 1280`);
    } else {
      lines.push(`Jc = ${obf.jc}`, `Jmin = ${obf.jmin}`, `Jmax = ${obf.jmax}`);
      obf.s.forEach((value, i) => lines.push(`S${i + 1} = ${value}`));
      obf.h.forEach((value, i) => lines.push(`H${i + 1} = ${value}`));
      lines.push(`I1 = ${buildI1(cps === "auto" ? "sip" : cps)}`);
      lines.push("ContentPaddingAddition = 10-100");
      lines.push("RekeyAfterTime = 100-120");
      lines.push("RekeyTimeout = 3-7");
      lines.push("RejectAfterTime = 150-180");
      lines.push("KeepaliveTimeout = 5-15");
      lines.push("MaxHandshakeAttempts = 15-20");
      lines.push("MTU = 1280");
    }

    lines.push("", "[Peer]", `PublicKey = ${cred.peer}`, `AllowedIPs = ${allowedIps()}`, `Endpoint = ${host}:${port}`, `PersistentKeepalive = ${keepalive}`, "");

    if ($("#cps5").value === "1") {
      for (let i = 2; i <= 5; i += 1) {
        lines.splice(lines.length - 7, 0, `I${i} = <b 0x${hex(`${rand(1000, 9999)}-${Math.random().toString(36).slice(2, 10)}`)}>`);
      }
    }
    return lines.join("\n");
  }

  function mask(text) {
    return text.replace(/^(PrivateKey = ).*$/gm, "$1<已隐藏>");
  }

  function renderConfig(text, meta) {
    state.currentText = text;
    state.previewText = mask(text);
    $("#result").hidden = false;
    $("#resultMeta").textContent = meta;
    $("#confText").textContent = state.previewText;
    $("#previewHint").hidden = false;
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "preview"));
  }

  function loadHistory() {
    try {
      state.history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      state.history = [];
    }
    renderHistory();
  }

  function renderHistory() {
    const list = $("#historyList");
    list.innerHTML = "";
    if (!state.history.length) {
      list.innerHTML = '<li class="empty">暂无记录</li>';
      return;
    }
    state.history.forEach((item, index) => {
      const li = document.createElement("li");
      li.innerHTML = `<span><strong>${item.mode.toUpperCase()}</strong> · ${item.endpoint}:${item.port} · ${item.routeMode}</span><small>${new Date(item.ts).toLocaleString("zh-CN")}</small>`;
      li.addEventListener("click", () => renderConfig(item.text, `${item.mode.toUpperCase()} · ${item.endpoint}:${item.port} · 历史记录`));
      list.appendChild(li);
      li.dataset.index = String(index);
    });
  }

  function saveHistory(meta, text) {
    const mode = $('input[name="profile"]:checked').value;
    let endpoint = $("#endpoint").value;
    if (endpoint === "custom") endpoint = $("#endpointCustom").value.trim();
    state.history.unshift({ ts: Date.now(), mode, endpoint, port: $("#port").value, routeMode: $('input[name="routeMode"]:checked').value, text });
    state.history = state.history.slice(0, 20);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    } catch {
      /* 存储不可用时仅保留在内存中 */
    }
    renderHistory();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制到剪贴板");
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      toast("已复制到剪贴板");
    }
  }

  function bindEvents() {
    $("#credMode").addEventListener("change", (event) => {
      const own = event.target.value === "own";
      $("#warpCred").hidden = own;
      $("#ownCred").hidden = !own;
      setCredential(null, own ? "自建服务器模式：私钥在本机生成或手动填写。" : "WARP 模式：请粘贴已注册的私钥。");
    });

    $("#parseCred").addEventListener("click", () => {
      try {
        const cred = parseCredentialText($("#credText").value);
        setCredential(cred);
        toast("凭据已解析");
      } catch (error) {
        setCredential(null, `解析失败：${error.message}`);
      }
    });

    $("#genKey").addEventListener("click", async () => {
      if (!state.x25519) {
        toast("当前浏览器不支持 Web Crypto X25519，请手动填写私钥");
        return;
      }
      try {
        const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
        const priv = bytesToB64(await crypto.subtle.exportKey("raw", pair.privateKey));
        $("#ownPriv").value = priv;
        toast("已生成本机私钥（仅适用于自建服务器）");
      } catch (error) {
        toast(`生成失败：${error.message}`);
      }
    });

    $$('input[name="routeMode"]').forEach((el) => el.addEventListener("change", () => {
      $("#routePresets").hidden = $('input[name="routeMode"]:checked').value !== "split";
    }));

    $("#dns").addEventListener("change", () => ($("#dnsCustomWrap").hidden = $("#dns").value !== "custom"));
    $("#endpoint").addEventListener("change", () => ($("#endpointCustomWrap").hidden = $("#endpoint").value !== "custom"));
    $("#openAdvanced").addEventListener("click", () => $("#advanced").showModal());
    $("#resetAdvanced").addEventListener("click", () => {
      $("#cps").value = "auto";
      $("#cps5").value = "0";
      ["#jcOverride", "#jminOverride", "#jmaxOverride", "#i1Hex"].forEach((s) => ($(s).value = ""));
    });

    $("#genForm").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const cred = currentCredential();
        const mode = $('input[name="profile"]:checked').value;
        const warpSafe = $("#credMode").value === "warp";
        const count = Number($("#count").value);
        const configs = Array.from({ length: count }, () => buildConfig(mode, cred, warpSafe));
        const text = configs.join("\n\n");
        let endpoint = $("#endpoint").value;
        if (endpoint === "custom") endpoint = $("#endpointCustom").value.trim() || "自定义";
        renderConfig(text, `${mode.toUpperCase()} · ${endpoint}:${$("#port").value} · 共 ${count} 份配置 · 本地生成`);
        saveHistory(`共 ${count} 份`, text);
        toast("配置生成完成");
      } catch (error) {
        toast(error.message);
      }
    });

    $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      const preview = tab.dataset.tab === "preview";
      $("#confText").textContent = preview ? state.previewText : state.currentText;
      $("#previewHint").hidden = !preview;
    }));

    $("#copyConf").addEventListener("click", () => copyText(state.currentText));
    $("#download").addEventListener("click", () => {
      if (!state.currentText) return;
      const mode = $('input[name="profile"]:checked').value;
      const blob = new Blob([state.currentText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `AWG_${mode}_${new Date().toISOString().slice(0, 10)}.conf`;
      a.click();
      URL.revokeObjectURL(url);
      toast("配置已下载");
    });

    $("#clearHistory").addEventListener("click", () => {
      state.history = [];
      try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
      renderHistory();
      toast("历史已清空");
    });
  }

  detectEnvironment();
  bindEvents();
  loadHistory();
})();
