/**
 * Пауза в миллисекундах.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSessionIDFromCookies(cookies) {
  if (!Array.isArray(cookies)) return null;

  const raw = cookies.find((c) => typeof c === 'string' && c.startsWith('sessionid='));
  if (!raw) return null;

  return raw.split(';')[0].slice('sessionid='.length);
}

async function createListingViaHttp(community, sessionID, assetid, appid, contextid, priceInCents) {
  if (!sessionID) {
    throw new Error('Для HTTP fallback нужен sessionID');
  }

  console.log('ℹ️ Использую HTTP fallback: POST /market/sellitem/');

  const requestOptions = {
    method: 'POST',
    uri: 'https://steamcommunity.com/market/sellitem/',
    form: {
      sessionid: sessionID,
      appid,
      contextid,
      assetid,
      amount: 1,
      price: priceInCents,
    },
    json: true,
  };

  if (typeof community.httpRequest === 'function') {
    return new Promise((resolve, reject) => {
      community.httpRequest(requestOptions, (err, response, body) => {
        if (err) {
          reject(err);
          return;
        }

        const payload = body || response?.body || {};
        if (payload?.success !== true && payload?.success !== 1) {
          reject(new Error(`Market API error: ${JSON.stringify(payload)}`));
          return;
        }

        resolve(payload);
      });
    });
  }

  if (community.request && typeof community.request.post === 'function') {
    return new Promise((resolve, reject) => {
      community.request.post(requestOptions, (err, response, body) => {
        if (err) {
          reject(err);
          return;
        }

        const payload = body || response?.body || {};
        if (payload?.success !== true && payload?.success !== 1) {
          reject(new Error(`Market API error: ${JSON.stringify(payload)}`));
          return;
        }

        resolve(payload);
      });
    });
  }

  throw new Error('В текущем steamcommunity нет методов для HTTP-запроса (httpRequest/request.post)');
}

/**
 * Унифицированное выставление лота для разных версий steamcommunity.
 */
async function createListing(community, sessionID, assetid, appid, contextid, priceInCents) {
  if (typeof community.sellItem === 'function') {
    console.log('ℹ️ Использую community.sellItem(...)');
    return new Promise((resolve, reject) => {
      community.sellItem({ assetid, appid, contextid, price: priceInCents }, (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result || {});
      });
    });
  }

  if (typeof community.createMarketListing === 'function') {
    console.log('ℹ️ Использую community.createMarketListing(...)');
    return new Promise((resolve, reject) => {
      community.createMarketListing(appid, contextid, assetid, priceInCents, (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result || {});
      });
    });
  }

  return createListingViaHttp(community, sessionID, assetid, appid, contextid, priceInCents);
}

/**
 * Выставляет предмет на продажу и подтверждает листинг.
 *
 * @param {import('steamcommunity')} community
 * @param {string} itemName
 * @param {number|string} targetPrice
 * @param {string} identitySecret
 * @param {number|string} [appid=730]
 * @param {number|string} [contextid=2]
 * @param {string|null} [sessionID=null]
 * @returns {Promise<boolean>}
 */
async function sellItem(
  community,
  itemName,
  targetPrice,
  identitySecret,
  appid = 730,
  contextid = 2,
  sessionID = null
) {
  try {
    if (!community) {
      throw new Error('Не передан объект community');
    }

    if (!community.steamID) {
      throw new Error('В community отсутствует steamID (проверьте cookies)');
    }

    if (!identitySecret) {
      throw new Error('Не передан identitySecret');
    }

    console.log(`🔎 Поиск предмета: ${itemName}`);

    const inventory = await new Promise((resolve, reject) => {
      community.getUserInventoryContents(
        community.steamID,
        appid,
        contextid,
        true,
        (err, items) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(items || []);
        }
      );
    });

    const item = inventory.find((invItem) => invItem.market_hash_name === itemName);
    if (!item) {
      console.log(`❌ Предмет не найден: ${itemName}`);
      return false;
    }

    const assetid = item.assetid;
    const priceInCents = Math.round(Number(String(targetPrice).replace(',', '.')) * 100);

    if (!Number.isFinite(priceInCents) || priceInCents <= 0) {
      throw new Error(`Некорректная цена: ${targetPrice}`);
    }

    const effectiveSessionID = sessionID || extractSessionIDFromCookies(community._cookies || []);

    console.log(`📤 Выставление предмета (assetid: ${assetid}) за ${priceInCents}`);
    await createListing(community, effectiveSessionID, assetid, appid, contextid, priceInCents);

    console.log('⏳ Ждем 3 секунды перед подтверждением...');
    await sleep(3000);

    console.log('🔐 Подтверждение листинга...');
    await new Promise((resolve, reject) => {
      community.acceptConfirmationForObject(identitySecret, assetid, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    console.log('✅ Продажа успешно подтверждена');
    return true;
  } catch (error) {
    console.error('❌ Ошибка в sellItem:', error.message || error);
    return false;
  }
}

module.exports = {
  sellItem,
};
