const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');

// Создаем экземпляр steam-user с настройками, полезными для ботов
const client = new SteamUser({
  autoRelogin: true,
  promptSteamGuardCode: false,
});

// Хранилище веб-сессии (будет заполнено после события webSession)
const authState = {
  cookies: [],
  sessionID: null,
};

/**
 * Выполняет вход в Steam с поддержкой 2FA через sharedSecret.
 *
 * Ожидает переменные окружения:
 * - STEAM_ACCOUNT_NAME
 * - STEAM_PASSWORD
 * - STEAM_SHARED_SECRET
 */
function login() {
  const accountName = process.env.STEAM_ACCOUNT_NAME;
  const password = process.env.STEAM_PASSWORD;
  const sharedSecret = process.env.STEAM_SHARED_SECRET;

  if (!accountName || !password || !sharedSecret) {
    throw new Error(
      'Не заданы STEAM_ACCOUNT_NAME, STEAM_PASSWORD или STEAM_SHARED_SECRET'
    );
  }

  // Генерируем одноразовый 2FA-код (Steam Guard) из sharedSecret
  const twoFactorCode = SteamTotp.generateAuthCode(sharedSecret);

  client.logOn({
    accountName,
    password,
    twoFactorCode,
  });
}

// Срабатывает после успешного входа в аккаунт Steam
client.on('loggedOn', () => {
  console.log('✅ Успешный вход в Steam');

  // Запрашиваем веб-сессию (нужна для работы с Community/Market/TradeOfferManager)
  client.webLogOn();
});

// Получаем cookies и sessionID веб-сессии для других модулей
client.on('webSession', (sessionID, cookies) => {
  authState.sessionID = sessionID;
  authState.cookies = cookies;

  console.log('🌐 WebSession получена: cookies и sessionID сохранены');
});

client.on('error', (err) => {
  console.error('❌ Ошибка Steam-клиента:', err);
});

module.exports = {
  client,
  login,
  authState,
};
