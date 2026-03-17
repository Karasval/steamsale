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

    const timeout = setTimeout(() => {
      finishWithError(new Error(`[${login}] Таймаут ожидания webSession`));
    }, 60000);

    const clearHandlers = () => {
      clearTimeout(timeout);
      user.removeListener('error', onError);
      user.removeListener('loggedOn', onLoggedOn);
      user.removeListener('webSession', onWebSession);
    };

    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      clearHandlers();
      reject(error);
    };

    const onError = (error) => {
      finishWithError(error);
    };

    const onLoggedOn = () => {
      console.log(`✅ [${login}] Успешный вход в Steam`);
      console.log(`🌐 [${login}] Запрашиваю webSession...`);

      // В реальных сценариях событие webSession часто не приходит само,
      // поэтому запрашиваем web-сессию вручную.
      user.webLogOn();
    };

    const onWebSession = (_sessionID, cookies) => {
      if (settled) return;
      settled = true;
      clearHandlers();
      console.log(`🍪 [${login}] webSession получена`);
      resolve({ client: user, cookies });
    };

    user.on('error', onError);
    user.on('loggedOn', onLoggedOn);
    user.on('webSession', onWebSession);

    SteamTotp.getTimeOffset((offsetError, offset) => {
      if (offsetError) {
        finishWithError(offsetError);
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
