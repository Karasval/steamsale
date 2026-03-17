const readline = require('readline');
const SteamCommunity = require('steamcommunity');

// Общий экземпляр community. Cookies/sessionID должны быть установлены снаружи (из auth-модуля).
const community = new SteamCommunity();

/**
 * Пауза в миллисекундах.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Преобразует код валюты Steam в строковый код (RUB, USD, UAH и т.д.).
 * Если код уже строка, возвращает его как есть.
 */
function normalizeCurrency(currency) {
  if (!currency) return 'UNKNOWN';
  if (typeof currency === 'string') return currency.toUpperCase();

  const currencyMap = {
    1: 'USD',
    3: 'EUR',
    5: 'RUB',
    18: 'UAH',
  };

  return currencyMap[currency] || String(currency);
}

/**
 * Интерактивно запрашивает цену и выставляет предмет на продажу на Steam Market.
 *
 * @param {string} market_hash_name - Название предмета в маркете.
 * @param {number|string} appid - AppID игры (например 730).
 * @param {number|string} contextid - ContextID инвентаря (например 2).
 */
async function promptAndSellItem(market_hash_name, appid, contextid) {
  let rl;

  try {
    console.log(`🔎 Поиск предмета в инвентаре: ${market_hash_name}`);

    const inventory = await new Promise((resolve, reject) => {
      community.getUserInventoryContents(appid, contextid, false, (err, items) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(items || []);
      });
    });

    const item = inventory.find(
      (invItem) => invItem && invItem.market_hash_name === market_hash_name
    );

    if (!item) {
      console.error(`❌ Предмет не найден: ${market_hash_name}`);
      return;
    }

    const assetid = item.assetid;
    console.log(`✅ Предмет найден. assetid: ${assetid}`);

    console.log('💰 Получение валюты аккаунта...');

    const walletInfo = await new Promise((resolve, reject) => {
      if (typeof community.getWalletInfo === 'function') {
        community.getWalletInfo((err, info) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(info || {});
        });
        return;
      }

      if (community.wallet) {
        resolve(community.wallet);
        return;
      }

      resolve({});
    });

    const currency = normalizeCurrency(
      walletInfo.currency_code || walletInfo.currency || walletInfo.wallet_currency
    );

    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const priceInput = await new Promise((resolve) => {
      rl.question(
        `Предмет найден. Валюта аккаунта: ${currency}. Введите цену, по которой выставить предмет на продажу: `,
        resolve
      );
    });

    rl.close();
    rl = null;

    const parsedPrice = Number(String(priceInput).replace(',', '.'));
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      console.error('❌ Некорректная цена. Введите положительное число.');
      return;
    }

    // Никаких расчетов комиссий: просто переводим введенную цену в минимальные единицы.
    const priceInCents = Math.round(parsedPrice * 100);

    console.log(`📤 Выставление предмета на продажу за ${priceInCents} (минимальные единицы)...`);

    const sellResult = await new Promise((resolve, reject) => {
      community.sellItem(assetid, appid, contextid, priceInCents, (err, result) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result || {});
      });
    });

    console.log('✅ Лот создан, ожидаю 3 секунды перед подтверждением...');
    await sleep(3000);

    const identitySecret = process.env.STEAM_IDENTITY_SECRET;
    if (!identitySecret) {
      console.error('❌ Не задан STEAM_IDENTITY_SECRET для подтверждения лота.');
      return;
    }

    const confirmationObjectId =
      sellResult.listingid || sellResult.listing_id || sellResult.sell_listingid || assetid;

    console.log(`🔐 Подтверждение лота через Steam Guard (objectID: ${confirmationObjectId})...`);

    await new Promise((resolve, reject) => {
      community.acceptConfirmationForObject(
        identitySecret,
        confirmationObjectId,
        (err) => {
          if (err) {
            reject(err);
            return;
          }

          resolve();
        }
      );
    });

    console.log('🎉 Продажа подтверждена успешно.');
  } catch (error) {
    console.error('❌ Ошибка в promptAndSellItem:', error);
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

module.exports = {
  community,
  promptAndSellItem,
};
