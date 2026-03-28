/**
 * Извлекает sessionid из массива cookies steamcommunity.
 */
function extractSessionIDFromCookies(cookies) {
  if (!Array.isArray(cookies)) return null;

  const raw = cookies.find((c) => typeof c === 'string' && c.startsWith('sessionid='));
  if (!raw) return null;

  return raw.split(';')[0].slice('sessionid='.length);
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

    if (!currency && currency !== 0) {
      throw new Error('Не удалось определить currency кошелька');
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
      community.sessionID ||
      extractSessionIDFromCookies(community._cookies || []);

    if (!sessionID) {
      throw new Error('Не удалось определить sessionid для createbuyorder');
    }

    const requestOptions = {
      method: 'POST',
      uri: 'https://steamcommunity.com/market/createbuyorder/',
      form: {
        sessionid: String(sessionID),
        currency: String(currency),
        appid: String(appId),
        market_hash_name: String(marketHashName),
        price_total: String(priceTotal),
        quantity: String(quantity),
      },
      headers: {
        Origin: 'https://steamcommunity.com',
        Referer: 'https://steamcommunity.com/market/',
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
