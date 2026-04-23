const axios = require("axios");
const crypto = require("crypto");
const totp = require("steam-totp");
const { buildRsaPublicKey } = require("./steamGuard");

const BASE = "https://steamcommunity.com";

function parseCookies(setCookie = []) {
  const jar = {};
  for (const row of setCookie) {
    const [pair] = row.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      jar[key] = value;
    }
  }
  return jar;
}

function toCookieHeader(cookieObj) {
  return Object.entries(cookieObj)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchRsaKey(client, username) {
  const body = new URLSearchParams({
    username,
    donotcache: `${Date.now()}`,
  });

  const { data } = await client.post(`${BASE}/login/getrsakey/`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
  });

  if (!data?.success || !data?.publickey_mod || !data?.publickey_exp || !data?.timestamp) {
    throw new Error("Failed to fetch RSA key");
  }

  return data;
}

async function login({ username, password, shared_secret }) {
  const client = axios.create({
    withCredentials: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Origin: BASE,
      Referer: `${BASE}/login/home/?goto=market%2F`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  const rsa = await fetchRsaKey(client, username);
  const publicKey = buildRsaPublicKey(rsa.publickey_mod, rsa.publickey_exp);
  const encryptedPassword = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(password, "utf8")
  );

  const twofactorcode = totp.generateAuthCode(shared_secret);
  const loginBody = new URLSearchParams({
    username,
    password: encryptedPassword.toString("base64"),
    twofactorcode,
    emailauth: "",
    loginfriendlyname: "",
    captcha_gid: "-1",
    captcha_text: "",
    emailsteamid: "",
    rsatimestamp: rsa.timestamp,
    remember_login: "true",
    donotcache: `${Date.now()}`,
  });

  const response = await client.post(`${BASE}/login/dologin/`, loginBody.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
  });

  const data = response.data;
  if (!data?.success) {
    throw new Error(`Login failed: ${data?.message || "unknown"}`);
  }

  const jar = parseCookies(response.headers["set-cookie"] || []);
  const sessionid = jar.sessionid || data.sessionid;

  if (!jar.steamLoginSecure || !sessionid) {
    throw new Error("Missing required auth cookies after login");
  }

  const cookies = toCookieHeader(jar);

  return {
    cookies,
    sessionid,
    jar,
  };
}

module.exports = {
  login,
  parseCookies,
  toCookieHeader,
};
