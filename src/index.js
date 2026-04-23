const axios = require("axios");
const config = require("./config");
const { login } = require("./auth");
const { getPrice, createBuyOrder } = require("./market");
const { getConfirmations, acceptAllConfirmations } = require("./confirmations");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs() {
  return 1000 + Math.floor(Math.random() * 1000);
}

class SteamBot {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessionid = "";
    this.cookies = "";
    this.client = axios.create({
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: "https://steamcommunity.com/market/",
      },
      validateStatus: () => true,
    });
  }

  async relogin() {
    const res = await login(this.cfg);
    this.sessionid = res.sessionid;
    this.cookies = res.cookies;
    this.client.defaults.headers.Cookie = this.cookies;
    console.log("[AUTH] success");
  }

  async withRetry(label, fn, attempts = 3) {
    let lastErr;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        await sleep(randomDelayMs());
        return await fn();
      } catch (error) {
        lastErr = error;
        const status = error?.response?.status;

        if (status === 403 && i < attempts) {
          console.log(`[ERROR] ${label}: HTTP 403, relogin and retry (${i}/${attempts})`);
          await this.relogin();
          continue;
        }

        if (status === 429 && i < attempts) {
          const backoff = 1500 * i;
          console.log(`[ERROR] ${label}: HTTP 429, backoff ${backoff}ms (${i}/${attempts})`);
          await sleep(backoff);
          continue;
        }

        if (!status && i < attempts) {
          console.log(`[ERROR] ${label}: network error, retry (${i}/${attempts})`);
          await sleep(1200 * i);
          continue;
        }

        break;
      }
    }

    throw lastErr;
  }

  async run() {
    await this.withRetry("login", async () => this.relogin());

    const price = await this.withRetry("getPrice", async () =>
      getPrice(this.client, {
        appid: this.cfg.item.appid,
        market_hash_name: this.cfg.item.market_hash_name,
        currency: this.cfg.currency,
      })
    );

    console.log(`[PRICE] fetched: ${price.raw} (${price.cents} cents)`);

    if (price.cents > this.cfg.item.price_limit) {
      console.log(`[ERROR] price ${price.cents} exceeds limit ${this.cfg.item.price_limit}, skipping buy order`);
      return;
    }

    await this.withRetry("createBuyOrder", async () =>
      createBuyOrder(this.client, {
        sessionid: this.sessionid,
        currency: this.cfg.currency,
        appid: this.cfg.item.appid,
        market_hash_name: this.cfg.item.market_hash_name,
        quantity: this.cfg.item.quantity || 1,
        price_total: price.cents,
        price_limit: this.cfg.item.price_limit,
      })
    );

    console.log("[ORDER] created");

    await sleep(3000);

    const confs = await this.withRetry("getConfirmations", async () =>
      getConfirmations(this.client, {
        identity_secret: this.cfg.identity_secret,
        steamID: this.cfg.steamID,
      })
    );

    const result = await this.withRetry("acceptAllConfirmations", async () =>
      acceptAllConfirmations(this.client, {
        identity_secret: this.cfg.identity_secret,
        steamID: this.cfg.steamID,
        confirmations: confs,
      })
    );

    console.log(`[CONFIRM] accepted ${result.count}`);
  }
}

(async () => {
  try {
    const bot = new SteamBot(config);
    await bot.run();
  } catch (err) {
    const msg = err?.response?.data?.message || err?.message || String(err);
    console.error(`[ERROR] ${msg}`);
    process.exitCode = 1;
  }
})();
