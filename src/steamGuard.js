const crypto = require("crypto");

function toBase64UrlFromHex(hex) {
  return Buffer.from(hex, "hex")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateDeviceID(steamID) {
  const hash = crypto.createHash("sha1").update(String(steamID)).digest("hex");
  const androidId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  return `android:${androidId}`;
}

function generateConfirmationKey(identitySecret, tag, time = Math.floor(Date.now() / 1000)) {
  const buffer = Buffer.alloc(8 + tag.length);
  buffer.writeUInt32BE(0, 0);
  buffer.writeUInt32BE(time, 4);
  buffer.write(tag, 8, "ascii");

  return crypto
    .createHmac("sha1", Buffer.from(identitySecret, "base64"))
    .update(buffer)
    .digest("base64");
}

function buildRsaPublicKey(modulusHex, exponentHex) {
  const jwk = {
    kty: "RSA",
    n: toBase64UrlFromHex(modulusHex),
    e: toBase64UrlFromHex(exponentHex),
    alg: "RSA1_5",
    ext: true,
  };

  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

module.exports = {
  generateDeviceID,
  generateConfirmationKey,
  buildRsaPublicKey,
};
