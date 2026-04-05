const SteamTotp = require('steam-totp');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimeOffsetAsync() {
  return new Promise((resolve, reject) => {
    SteamTotp.getTimeOffset((error, offset) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(offset || 0);
    });
  });
}

async function getConfirmationsSafe(community, identitySecret) {
  const offset = await getTimeOffsetAsync();
  const time = Math.floor(Date.now() / 1000) + offset;
  const key = SteamTotp.getConfirmationKey(identitySecret, time, 'conf');

  return new Promise((resolve, reject) => {
    community.getConfirmations(time, key, (error, confirmations) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Array.isArray(confirmations) ? confirmations : []);
    });
  });
}

async function acceptByObjectIdSafe(community, identitySecret, objectId) {
  return new Promise((resolve, reject) => {
    community.acceptConfirmationForObject(identitySecret, String(objectId), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(true);
    });
  });
}

async function confirmBuyOrderIfNeeded(community, identitySecret, responsePayload) {
  if (!identitySecret) {
    return { confirmed: false, message: 'Нужен identity_secret для подтверждения buy order' };
  }

  const confirmationId = responsePayload?.confirmation?.confirmation_id;
  if (confirmationId) {
    try {
      await acceptByObjectIdSafe(community, identitySecret, confirmationId);
      return { confirmed: true, message: 'Buy order подтвержден через confirmation_id' };
    } catch {
      // fallback ниже через scan
    }
  }

  for (let i = 0; i < 5; i += 1) {
    const confirmations = await getConfirmationsSafe(community, identitySecret);
    const marketConfirmation = confirmations.find((c) => {
      const type = String(c?.type || '').toLowerCase();
      const typeName = String(c?.typeName || '').toLowerCase();
      const headline = String(c?.headline || '').toLowerCase();
      return (
        type.includes('market') ||
        typeName.includes('market') ||
        headline.includes('buy order') ||
        headline.includes('purchase')
      );
    });

    if (marketConfirmation?.id) {
      await acceptByObjectIdSafe(community, identitySecret, marketConfirmation.id);
      return { confirmed: true, message: 'Buy order подтвержден через scan fallback' };
    }

    if (i < 4) {
      await sleep(3000);
    }
  }

  return { confirmed: false, message: 'Не удалось найти подтверждение buy order' };
}

async function fetchMyBuyOrdersSnapshot(community) {
  const options = {
    method: 'GET',
    uri: 'https://steamcommunity.com/market/mylistings/render/?query=&start=0&count=100',
    gzip: true,
    json: true,
  };

  return new Promise((resolve, reject) => {
    const cb = (error, response, body) => {
      if (error) {
        reject(error);
        return;
      }

      const statusCode = response?.statusCode || 0;
      if (statusCode >= 400) {
        reject(new Error(`mylistings render failed: HTTP ${statusCode}`));
        return;
      }

      let payload = body;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      resolve(payload || {});
    };

    if (community.request && typeof community.request.get === 'function') {
      community.request.get(options, cb);
      return;
    }

    if (typeof community.httpRequest === 'function') {
      community.httpRequest(options, cb);
      return;
    }

    reject(new Error('Нет метода для GET /market/mylistings/render/'));
  });
}

function hasTargetBuyOrder(snapshot, appId, marketHashName) {
  if (!snapshot || typeof snapshot !== 'object') return false;

  const buyOrders = snapshot.buy_orders || snapshot.buyOrders || snapshot.rgBuyOrders || {};
  const entries = Array.isArray(buyOrders) ? buyOrders : Object.values(buyOrders);

  return entries.some((order) => {
    const text = JSON.stringify(order || {}).toLowerCase();
    return (
      text.includes(String(appId).toLowerCase()) &&
      text.includes(String(marketHashName).toLowerCase())
    );
  });
}

async function verifyBuyOrderExists(community, appId, marketHashName) {
  for (let i = 0; i < 5; i += 1) {
    try {
      const snapshot = await fetchMyBuyOrdersSnapshot(community);
      if (hasTargetBuyOrder(snapshot, appId, marketHashName)) {
        return true;
      }
    } catch {
      // игнорируем и повторяем
    }

    if (i < 4) {
      await sleep(2500);
    }
  }

  return false;
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
 * @param {string} [identitySecret]
 * @returns {Promise<{success: boolean, quantity: number, unitPrice: number, remainingBalance: number, message?: string, error?: string, confirmation?: object}>}
 */
async function placeBuyOrderOnFullBalance(
  community,
  appId,
  marketHashName,
  targetPrice,
  identitySecret
) {
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

      if (community.request && typeof community.request.get === 'function') {
        community.request.get(warmupOptions, cb);
        return;
      }

      if (typeof community.httpRequest === 'function') {
        community.httpRequest(warmupOptions, cb);
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
        const statusCode = response?.statusCode || 0;
        let payload = body || {};
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload || '{}');
          } catch {
            payload = { raw: payload };
          }
        }

        if (err && !statusCode) {
          reject(err);
          return;
        }

        if (statusCode === 429) {
          reject(new Error('429 Too Many Requests'));
          return;
        }

        const steamSuccessCode = Number(payload?.success);
        const steamSuccess =
          payload?.success === true ||
          steamSuccessCode === 1 ||
          steamSuccessCode === 22;

        if (statusCode >= 400 && !steamSuccess) {
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

        if (!steamSuccess) {
          reject(new Error(`Steam API error: ${JSON.stringify(payload)}`));
          return;
        }

        resolve(payload);
      };

      if (community.request && typeof community.request.post === 'function') {
        community.request.post(requestOptions, handle);
        return;
      }

      if (typeof community.httpRequest === 'function') {
        community.httpRequest(requestOptions, handle);
        return;
      }

      reject(new Error('Нет метода для POST /market/createbuyorder/ (httpRequest/request.post)'));
    });

    const needConfirmation =
      Number(responsePayload?.success) === 22 ||
      responsePayload?.need_confirmation === true;

    let confirmation = null;
    if (needConfirmation) {
      confirmation = await confirmBuyOrderIfNeeded(community, identitySecret, responsePayload);
    }

    const orderVisible = await verifyBuyOrderExists(community, appId, marketHashName);
    const finalSuccess = needConfirmation ? confirmation?.confirmed && orderVisible : orderVisible;

    return {
      success: Boolean(finalSuccess),
      quantity,
      unitPrice,
      remainingBalance: remainingBalanceMinor / 100,
      message: !orderVisible
        ? 'Steam ответил успехом, но ордер не найден в my listings'
        : needConfirmation
          ? confirmation?.confirmed
            ? 'Buy order создан и подтвержден'
            : 'Buy order создан, но подтверждение не выполнено'
          : 'Buy order успешно создан',
      confirmation,
      orderVisible,
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
