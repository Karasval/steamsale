function parsePriceToCents(priceValue) {
  if (typeof priceValue !== "string" || !priceValue.trim()) return null;

  let normalized = priceValue.replace(/[^\d.,]/g, "");
  const hasDot = normalized.includes(".");
  const hasComma = normalized.includes(",");

  if (hasComma && hasDot) {
    normalized = normalized.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    normalized = normalized.replace(",", ".");
  }

  const num = Number.parseFloat(normalized);
  if (Number.isNaN(num)) return null;

  return Math.round(num * 100);
}

async function getPrice(client, { appid, market_hash_name, currency }) {
  const { data } = await client.get("https://steamcommunity.com/market/priceoverview/", {
    params: {
      appid,
      market_hash_name,
      currency,
    },
  });

  if (!data?.success) {
    throw new Error("Failed to fetch priceoverview");
  }

  const raw = data.lowest_price || data.median_price;
  const cents = parsePriceToCents(raw);
  if (cents == null) {
    throw new Error(`Unable to parse market price: ${raw}`);
  }

  return { cents, raw };
}

async function createBuyOrder(client, {
  sessionid,
  currency,
  appid,
  market_hash_name,
  quantity,
  price_total,
  price_limit,
}) {
  if (price_total > price_limit) {
    throw new Error(`price_total ${price_total} exceeds price_limit ${price_limit}`);
  }

  const body = new URLSearchParams({
    sessionid,
    currency: String(currency),
    appid: String(appid),
    market_hash_name,
    price_total: String(price_total),
    quantity: String(quantity),
  });

  const { data } = await client.post("https://steamcommunity.com/market/createbuyorder/", body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
  });

  if (data?.success !== 1 && data?.success !== true) {
    throw new Error(`Failed to create buy order: ${data?.message || "unknown"}`);
  }

  return data;
}

module.exports = {
  getPrice,
  createBuyOrder,
  parsePriceToCents,
};
