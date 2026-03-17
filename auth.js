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

    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    user.once('error', finishWithError);

    user.once('loggedOn', () => {
      console.log(`✅ [${login}] Успешный вход в Steam`);
    });

    user.once('webSession', (_sessionID, cookies) => {
      if (settled) return;
      settled = true;
      resolve({ client: user, cookies });
    });

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
