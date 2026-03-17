const SteamTotp = require('steam-totp');

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

function buildMarketRequestOptions(community, sessionID, assetid, appid, contextid, priceInCents) {
  const steamID = String(community.steamID || '');

  return {
    method: 'POST',
    uri: 'https://steamcommunity.com/market/sellitem/',
    form: {
      sessionid: String(sessionID),
      appid: String(appid),
      contextid: String(contextid),
      assetid: String(assetid),
      amount: '1',
      price: String(priceInCents),
    },
    headers: {
      Origin: 'https://steamcommunity.com',
      Referer: steamID
        ? `https://steamcommunity.com/profiles/${steamID}/inventory/`
        : 'https://steamcommunity.com/market/',
      'X-Requested-With': 'XMLHttpRequest',
    },
    gzip: true,
  };
}

function parsePayload(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;

  try {
    return JSON.parse(body);
  } catch {
    return { raw: String(body) };
  }
}

function isConfirmationNotFoundError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('could not find confirmation for object');
}

function collectConfirmationObjectIDs(assetid, listingResult) {
  const ids = new Set();
  ids.add(String(assetid));

  const candidateFields = [
    listingResult?.listingid,
    listingResult?.listing_id,
    listingResult?.sell_listingid,
    listingResult?.sellid,
    listingResult?.sell_id,
    listingResult?.needs_mobile_confirmation_for_sellid,
  ];

  for (const value of candidateFields) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      ids.add(String(value));
    }
  }

  return [...ids];
}

async function acceptListingConfirmation(community, identitySecret, objectIDs) {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    for (const objectID of objectIDs) {
      try {
        await new Promise((resolve, reject) => {
          community.acceptConfirmationForObject(identitySecret, objectID, (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        });

        console.log(`✅ Подтверждение найдено и принято (objectID=${objectID})`);
        return true;
      } catch (error) {
        if (!isConfirmationNotFoundError(error)) {
          throw error;
        }
      }
    }

    if (attempt < maxAttempts) {
      console.log(
        `⏳ Подтверждение пока не появилось (попытка ${attempt}/${maxAttempts}), жду 3 сек...`
      );
      await sleep(3000);
    }
  }

  // Последний fallback: сканируем список подтверждений и берем свежее market-подтверждение.
  console.log('⚠️ По objectID подтверждение не найдено, пробую scan fallback...');
  await acceptMarketConfirmationByScan(community, identitySecret);
  return true;
}


async function getTimeOffsetSeconds() {
  return new Promise((resolve, reject) => {
    SteamTotp.getTimeOffset((err, offset) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(offset || 0);
    });
  });
}

async function loadConfirmations(community, identitySecret) {
  if (typeof community.getConfirmations !== 'function') {
    throw new Error('Метод community.getConfirmations недоступен');
  }

  const offset = await getTimeOffsetSeconds();
  const time = Math.floor(Date.now() / 1000) + offset;
  const confKey = SteamTotp.getConfirmationKey(identitySecret, time, 'conf');

  return new Promise((resolve, reject) => {
    community.getConfirmations(time, confKey, (err, confirmations) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(confirmations || []);
    });
  });
}

async function acceptMarketConfirmationByScan(community, identitySecret) {
  const confirmations = await loadConfirmations(community, identitySecret);

  const marketConfirmations = confirmations.filter((c) => {
    const type = Number(c?.type);
    const typeName = String(c?.typeName || c?.type_name || '').toLowerCase();
    return type === 3 || typeName.includes('market') || typeName.includes('listing');
  });

  if (marketConfirmations.length === 0) {
    throw new Error('В списке подтверждений нет market/listing подтверждений');
  }

  // Берем самое свежее market-подтверждение
  const target = marketConfirmations[0];
  const fallbackIDs = [target?.creator, target?.id].filter(Boolean).map((v) => String(v));

  for (const objectID of fallbackIDs) {
    try {
      await new Promise((resolve, reject) => {
        community.acceptConfirmationForObject(identitySecret, objectID, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });

      console.log(`✅ Подтверждение принято через scan fallback (objectID=${objectID})`);
      return true;
    } catch (_e) {
      // Пробуем следующий fallback ID
    }
  }

  throw new Error(
    `Не удалось подтвердить через scan fallback. confirmation.id=${target?.id}, creator=${target?.creator}`
  );
}

async function createListingViaHttp(community, sessionID, assetid, appid, contextid, priceInCents) {
  if (!sessionID) {
    throw new Error('Для HTTP fallback нужен sessionID');
  }

  console.log('ℹ️ Использую HTTP fallback: POST /market/sellitem/');
  const requestOptions = buildMarketRequestOptions(
    community,
    sessionID,
    assetid,
    appid,
    contextid,
    priceInCents
  );

  const handleResponse = (response, body, resolve, reject) => {
    const statusCode = response?.statusCode || 0;
    const payload = parsePayload(body ?? response?.body);

    if (statusCode >= 400) {
      reject(new Error(`HTTP error ${statusCode}. response=${JSON.stringify(payload)}`));
      return;
    }

    if (payload?.success !== true && payload?.success !== 1) {
      reject(new Error(`Market API error: ${JSON.stringify(payload)}`));
      return;
    }

    resolve(payload);
  };

  if (typeof community.httpRequest === 'function') {
    return new Promise((resolve, reject) => {
      community.httpRequest(requestOptions, (err, response, body) => {
        if (err) {
          reject(err);
          return;
        }

        handleResponse(response, body, resolve, reject);
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

        handleResponse(response, body, resolve, reject);
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

function shouldRequireConfirmation(listingResult) {
  if (!listingResult || typeof listingResult !== 'object') {
    return true;
  }

  const flags = [
    listingResult.needs_mobile_confirmation,
    listingResult.needs_confirmation,
    listingResult.requires_confirmation,
  ];

  if (flags.some((v) => v === true || v === 1 || v === '1')) {
    return true;
  }

  if (flags.some((v) => v === false || v === 0 || v === '0')) {
    return false;
  }

  return true;
}

/**
 * Выставляет предмет на продажу и подтверждает листинг.
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

    const effectiveSessionID =
      sessionID ||
      community.sessionID ||
      extractSessionIDFromCookies(community._cookies || []);

    if (!effectiveSessionID) {
      throw new Error('Не удалось определить sessionID для выставления лота');
    }

    console.log(`📤 Выставление предмета (assetid: ${assetid}) за ${priceInCents}`);
    const listingResult = await createListing(
      community,
      effectiveSessionID,
      assetid,
      appid,
      contextid,
      priceInCents
    );

    const needConfirmation = shouldRequireConfirmation(listingResult);

    if (!needConfirmation) {
      console.log('✅ Лот выставлен (подтверждение не требуется)');
      return true;
    }

    const objectIDs = collectConfirmationObjectIDs(assetid, listingResult);
    console.log(`🔐 Подтверждение листинга... objectIDs=${objectIDs.join(', ')}`);

    await acceptListingConfirmation(community, identitySecret, objectIDs);
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
