const { generateConfirmationKey, generateDeviceID } = require("./steamGuard");

async function getConfirmations(client, { identity_secret, steamID }) {
  const t = Math.floor(Date.now() / 1000);
  const params = {
    p: generateDeviceID(steamID),
    a: steamID,
    k: generateConfirmationKey(identity_secret, "conf", t),
    t,
    m: "android",
    tag: "conf",
  };

  const { data } = await client.get("https://steamcommunity.com/mobileconf/getlist", { params });

  if (!data?.success) {
    throw new Error("Failed to fetch confirmations");
  }

  return data.conf || [];
}

async function acceptAllConfirmations(client, { identity_secret, steamID, confirmations }) {
  if (!confirmations.length) return { success: true, count: 0 };

  const t = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams();
  params.append("op", "allow");
  params.append("p", generateDeviceID(steamID));
  params.append("a", steamID);
  params.append("k", generateConfirmationKey(identity_secret, "allow", t));
  params.append("t", String(t));
  params.append("m", "android");
  params.append("tag", "allow");

  for (const c of confirmations) {
    params.append("cid[]", c.id);
    params.append("ck[]", c.nonce);
  }

  const { data } = await client.post(
    "https://steamcommunity.com/mobileconf/multiajaxop",
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } }
  );

  if (!data?.success) {
    throw new Error("Failed to accept confirmations");
  }

  return { success: true, count: confirmations.length };
}

module.exports = {
  getConfirmations,
  acceptAllConfirmations,
};
