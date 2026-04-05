/**
 * Извлекает sessionid из массива cookies steamcommunity.
 */
function extractSessionIDFromCookies(cookies) {
  if (!Array.isArray(cookies)) return null;

  const raw = cookies.find((c) => typeof c === 'string' && c.startsWith('sessionid='));
  if (!raw) return null;

  return raw.split(';')[0].slice('sessionid='.length);
}

const CURRENCY_CODE_TO_ID = {
  USD: 1,
  GBP: 2,
  EUR: 3,
  CHF: 4,
  RUB: 5,
  PLN: 6,
  BRL: 7,
  JPY: 8,
  NOK: 9,
  IDR: 10,
  MYR: 11,
  PHP: 12,
  SGD: 13,
  THB: 14,
  VND: 15,
  KRW: 16,
  TRY: 17,
  UAH: 18,
  MXN: 19,
  CAD: 20,
  AUD: 21,
  NZD: 22,
  CNY: 23,
  INR: 24,
  CLP: 25,
  PEN: 26,
  COP: 27,
  ZAR: 28,
  HKD: 29,
  TWD: 30,
  SAR: 31,
  AED: 32,
  SEK: 33,
  ARS: 34,
  ILS: 35,
  BYN: 36,
  KZT: 37,
  KWD: 38,
  QAR: 39,
  CRC: 40,
  UYU: 41,
  BGN: 42,
  HRK: 43,
  CZK: 44,
  DKK: 45,
  HUF: 46,
  RON: 47,
};

function normalizeCurrencyToId(currencyRaw) {
  if (currencyRaw === null || currencyRaw === undefined) return null;
  if (typeof currencyRaw === 'number' && Number.isFinite(currencyRaw)) {
    return Math.trunc(currencyRaw);
  }
  const asNumber = Number(currencyRaw);
  if (Number.isFinite(asNumber)) {
    return Math.trunc(asNumber);
  }
  const code = String(currencyRaw).trim().toUpperCase();
  return CURRENCY_CODE_TO_ID[code] ?? null;
}

/**
 * Нормализует данные кошелька к виду в минимальных единицах и коде валюты.
 */
function normalizeWalletInfo(walletInfo) {
  // Чаще всего wallet_balance/wallet_currency уже приходят от Steam в минимальных единицах и numeric currency id.
  const balanceMinor =
    Number(walletInfo?.wallet_balance) ||
    Number(walletInfo?.balance) ||
    Number(walletInfo?.amount) ||
    0;

  const currency =
    walletInfo?.wallet_currency ??
    walletInfo?.currency ??
    walletInfo?.currency_code ??
    null;

  return {
    balanceMinor,
    currency,
  };
}

/**
 * Получает информацию о кошельке через getWalletInfo или fallback на HTML market page.
 */
async function getWalletInfoSafe(community) {
  if (typeof community.getWalletInfo === 'function') {
    const info = await new Promise((resolve, reject) => {
      community.getWalletInfo((err, walletInfo) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(walletInfo || {});
      });
    });

    return normalizeWalletInfo(info);
  }

  // Fallback: пробуем парсинг market-страницы.
  const html = await new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      uri: 'https://steamcommunity.com/market/',
    };

    if (typeof community.httpRequest === 'function') {
      community.httpRequest(options, (err, response, body) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(String(body || response?.body || ''));
      });
      return;
    }

    if (community.request && typeof community.request.get === 'function') {
      community.request.get(options, (err, response, body) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(String(body || response?.body || ''));
      });
      return;
    }

    reject(new Error('Нет метода для запроса market page (httpRequest/request.get)'));
  });

  const walletMatch = html.match(/g_rgWalletInfo\s*=\s*(\{[\s\S]*?\});/);
  if (!walletMatch) {
    throw new Error('Не удалось получить g_rgWalletInfo с market page');
  }

  const parsed = JSON.parse(walletMatch[1]);
  return normalizeWalletInfo(parsed);
}

/**
 * Выставляет buy order на весь доступный баланс.
 *
 * @param {import('steamcommunity')} community
 * @param {number|string} appId
 * @param {string} marketHashName
 * @param {number|string} targetPrice - цена за 1 шт в основных единицах (например, 12.34)
 * @returns {Promise<{success: boolean, quantity: number, unitPrice: number, remainingBalance: number, message?: string, error?: string}>}
 */
async function placeBuyOrderOnFullBalance(community, appId, marketHashName, targetPrice) {
  try {
    if (!community) {
      throw new Error('Не передан community');
    }

    if (!marketHashName) {
      throw new Error('Не передан marketHashName');
    }

    const unitPrice = Number(String(targetPrice).replace(',', '.'));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error(`Некорректный targetPrice: ${targetPrice}`);
    }

    const { balanceMinor, currency } = await getWalletInfoSafe(community);
    const currencyId = normalizeCurrencyToId(currency);

    if (!currencyId && currencyId !== 0) {
      throw new Error(`Не удалось определить currency кошелька (получено: ${currency})`);
    }

    const unitPriceMinor = Math.round(unitPrice * 100);
    if (unitPriceMinor <= 0) {
      throw new Error('Цена после конвертации в минимальные единицы <= 0');
    }

    const quantity = Math.floor(balanceMinor / unitPriceMinor);

    if (quantity < 1) {
      return {
        success: false,
        quantity: 0,
        unitPrice,
        remainingBalance: balanceMinor / 100,
        message: 'Недостаточно средств для покупки 1 предмета',
      };
    }

    const priceTotal = unitPriceMinor * quantity;
    const remainingBalanceMinor = balanceMinor - priceTotal;

    const sessionID =
      (typeof community.getSessionID === 'function' ? community.getSessionID() : null) ||
      community.sessionID ||
      extractSessionIDFromCookies(community._cookies || []);

    if (!sessionID) {
      throw new Error('Не удалось определить sessionid для createbuyorder');
    }

    const listingUrl = `https://steamcommunity.com/market/listings/${encodeURIComponent(
      String(appId)
    )}/${encodeURIComponent(String(marketHashName))}`;

    // Прогреваем market/listings страницу, чтобы Steam выставил нужные session cookies.
    await new Promise((resolve, reject) => {
      const warmupOptions = {
        method: 'GET',
        uri: listingUrl,
        gzip: true,
      };

      const cb = (err, response) => {
        if (err) {
          reject(err);
          return;
        }

        if ((response?.statusCode || 0) >= 400) {
          reject(new Error(`Warmup listing page failed: HTTP ${response.statusCode}`));
          return;
        }

        resolve();
      };

      if (typeof community.httpRequest === 'function') {
        community.httpRequest(warmupOptions, cb);
        return;
      }

      if (community.request && typeof community.request.get === 'function') {
        community.request.get(warmupOptions, cb);
        return;
      }

      reject(new Error('Нет метода для GET listing page (httpRequest/request.get)'));
    });

    const requestOptions = {
      method: 'POST',
      uri: 'https://steamcommunity.com/market/createbuyorder/',
      form: {
        sessionid: String(sessionID),
        currency: String(currencyId),
        appid: String(appId),
        market_hash_name: String(marketHashName),
        price_total: String(priceTotal),
        quantity: String(quantity),
        billing_state: '',
        save_my_address: '0',
      },
      headers: {
        Origin: 'https://steamcommunity.com',
        Referer: listingUrl,
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      gzip: true,
    };

    const responsePayload = await new Promise((resolve, reject) => {
      const handle = (err, response, body) => {
        if (err) {
          reject(err);
          return;
        }

        const statusCode = response?.statusCode || 0;
        let payload = body || {};
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload || '{}');
          } catch {
            payload = { raw: payload };
          }
        }

        if (statusCode === 429) {
          reject(new Error('429 Too Many Requests'));
          return;
        }

        if (statusCode >= 400) {
          if (statusCode === 406) {
            reject(
              new Error(
                `HTTP 406: Steam отклонил запрос. Проверьте валидность session/cookies, currency=${currencyId}, item=${marketHashName}, response=${JSON.stringify(
                  payload
                )}`
              )
            );
            return;
          }
          reject(new Error(`HTTP ${statusCode}: ${JSON.stringify(payload)}`));
          return;
        }

        if (payload?.success !== true && payload?.success !== 1) {
          reject(new Error(`Steam API error: ${JSON.stringify(payload)}`));
          return;
        }

        resolve(payload);
      };

      if (typeof community.httpRequest === 'function') {
        community.httpRequest(requestOptions, handle);
        return;
      }

      if (community.request && typeof community.request.post === 'function') {
        community.request.post(requestOptions, handle);
        return;
      }

      reject(new Error('Нет метода для POST /market/createbuyorder/ (httpRequest/request.post)'));
    });

    return {
      success: true,
      quantity,
      unitPrice,
      remainingBalance: remainingBalanceMinor / 100,
      message: 'Buy order успешно создан',
      response: responsePayload,
    };
  } catch (error) {
    return {
      success: false,
      quantity: 0,
      unitPrice: Number(String(targetPrice).replace(',', '.')) || 0,
      remainingBalance: 0,
      error: error?.message || String(error),
    };
  }
}

module.exports = {
  placeBuyOrderOnFullBalance,
};
