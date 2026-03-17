const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');

/**
 * Авторизация в Steam для одного аккаунта.
 * Создает новый экземпляр SteamUser внутри функции.
 *
 * @param {string} login
 * @param {string} password
 * @param {string} sharedSecret
 * @returns {Promise<{client: import('steam-user'), cookies: string[]}>}
 */
function authorize(login, password, sharedSecret) {
  return new Promise((resolve, reject) => {
    if (!login || !password || !sharedSecret) {
      reject(new Error('Не переданы login/password/sharedSecret'));
      return;
    }

    const user = new SteamUser({
      autoRelogin: false,
      promptSteamGuardCode: false,
    });

    let settled = false;
    let relogInterval = null;

    const cleanup = () => {
      if (relogInterval) {
        clearInterval(relogInterval);
        relogInterval = null;
      }
      user.removeListener('error', onError);
      user.removeListener('loggedOn', onLoggedOn);
      user.removeListener('webSession', onWebSession);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (cookies) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Выносим resolve в следующий тик, чтобы гарантировать переход дальше по цепочке await.
      setImmediate(() => resolve({ client: user, cookies }));
    };

    const loginTimeout = setTimeout(() => {
      fail(new Error(`[${login}] Таймаут ожидания webSession`));
    }, 90000);

    const stopTimeout = () => clearTimeout(loginTimeout);

    const onError = (error) => {
      stopTimeout();
      fail(error);
    };

    const onLoggedOn = () => {
      console.log(`✅ [${login}] Успешный вход в Steam`);
      console.log(`🌐 [${login}] Запрашиваю webSession...`);

      user.webLogOn();

      // Иногда первый webLogOn не срабатывает, повторяем мягко каждые 5 секунд.
      relogInterval = setInterval(() => {
        if (settled) return;
        user.webLogOn();
      }, 5000);
    };

    const onWebSession = (_sessionID, cookies) => {
      stopTimeout();
      console.log(`🍪 [${login}] webSession получена`);
      succeed(cookies);
    };

    user.on('error', onError);
    user.on('loggedOn', onLoggedOn);
    user.on('webSession', onWebSession);

    SteamTotp.getTimeOffset((offsetError, offset) => {
      if (offsetError) {
        stopTimeout();
        fail(offsetError);
        return;
      }

      const twoFactorCode = SteamTotp.generateAuthCode(sharedSecret, offset);

      user.logOn({
        accountName: login,
        password,
        twoFactorCode,
      });
    });
  });
}

module.exports = {
  authorize,
};
