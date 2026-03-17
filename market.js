/**
 * Пауза в миллисекундах.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * @returns {Promise<boolean>}
 */
async function sellItem(
  community,
  itemName,
  targetPrice,
  identitySecret,
  appid = 730,
  contextid = 2
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

    console.log(`📤 Выставление предмета (assetid: ${assetid}) за ${priceInCents}`);

    await new Promise((resolve, reject) => {
      community.sellItem({ assetid, appid, contextid, price: priceInCents }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

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
