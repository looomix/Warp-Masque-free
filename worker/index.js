const API_ORIGIN = "https://api.cloudflareclient.com";
const API_VERSION = "v0a4471";
const CF_HEADERS = {
  "User-Agent": "WARP for Android",
  "CF-Client-Version": "a-6.35-4471",
  "Content-Type": "application/json; charset=UTF-8",
  Accept: "application/json",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Usque-Intent",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store", ...CORS },
  });
}

function text(body, status = 200, type = "text/yaml; charset=utf-8") {
  return new Response(body, { status, headers: { "Content-Type": type, "Cache-Control": "no-store", ...CORS } });
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function readJson(request) {
  const body = await request.json();
  if (!body || typeof body !== "object") throw new Error("请求体必须是 JSON 对象");
  return body;
}

async function upstream(path, init) {
  const response = await fetch(`${API_ORIGIN}/${API_VERSION}${path}`, { ...init, redirect: "manual" });
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw.slice(0, 500) };
  }
  if (!response.ok) return { error: data.message || `Cloudflare HTTP ${response.status}`, status: response.status };
  return { data };
}

async function register(request) {
  let body;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ message: e.message }, 400);
  }
  const key = String(body.key || "");
  const serial = String(body.serial_number || "");
  const tos = String(body.tos || "");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) return json({ message: "key 无效" }, 400);
  if (!/^[0-9a-f]{16}$/i.test(serial)) return json({ message: "serial_number 无效" }, 400);
  if (tos.length < 20 || tos.length > 64) return json({ message: "tos 无效" }, 400);

  const result = await upstream("/reg", {
    method: "POST",
    headers: CF_HEADERS,
    body: JSON.stringify({
      key,
      install_id: "",
      fcm_token: "",
      tos,
      model: "PC",
      serial_number: serial,
      os_version: "",
      key_type: "curve25519",
      tunnel_type: "wireguard",
      locale: "en_US",
    }),
  });
  return result.error ? json({ message: result.error }, result.status) : json(result.data);
}

async function enroll(request) {
  let body;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ message: e.message }, 400);
  }
  const id = String(body.id || "");
  const token = String(body.token || "");
  const publicKey = String(body.public_key || "");
  const name = String(body.name || "Web-WARP").slice(0, 64);
  if (!/^[A-Za-z0-9._:-]{4,256}$/.test(id)) return json({ message: "device id 无效" }, 400);
  if (token.length < 8 || token.length > 4096) return json({ message: "token 无效" }, 400);
  if (!/^[A-Za-z0-9+/]{100,}$/.test(publicKey)) return json({ message: "P-256 public_key 无效" }, 400);

  const result = await upstream(`/reg/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...CF_HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: publicKey, key_type: "secp256r1", tunnel_type: "masque", name }),
  });
  return result.error ? json({ message: result.error }, result.status) : json(result.data);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "warp-config-relay", worker: "running" });
    }
    if (url.pathname === "/api/warp/register" && request.method === "POST") return register(request);
    if (url.pathname === "/api/warp/enroll" && request.method === "POST") return enroll(request);

    if (url.pathname === "/api/sub" && request.method === "POST") {
      let body;
      try {
        body = await readJson(request);
      } catch (e) {
        return json({ message: e.message }, 400);
      }
      const content = String(body.content || "");
      if (!content.trim()) return json({ message: "content 不能为空" }, 400);
      const token = b64urlEncode(content);
      return json({ url: `${url.origin}/sub/${token}`, token });
    }

    if (url.pathname.startsWith("/sub/") && request.method === "GET") {
      const token = url.pathname.slice("/sub/".length);
      try {
        return text(b64urlDecode(token));
      } catch {
        return json({ message: "订阅令牌无效" }, 400);
      }
    }

    return json({ message: "Not found" }, 404);
  },
};
