const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const SteamCommunity = require('steamcommunity');

const { authorize } = require('./auth');
const { placeBuyOrderOnFullBalance } = require('./buyOrder');

const TF2_APP_ID = 440;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askBuyInputs() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const marketHashName = await new Promise((resolve) => {
      rl.question('Введите точное название предмета для покупки: ', resolve);
    });

    const targetPrice = await new Promise((resolve) => {
      rl.question('Введите цену за 1 предмет: ', resolve);
    });

    return {
      marketHashName: marketHashName.trim(),
      targetPrice: targetPrice.trim(),
    };
  } finally {
    rl.close();
  }
}

async function readAccounts() {
  const raw = await fs.readFile(path.join(__dirname, 'accounts.txt'), 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [login, ...passwordParts] = line.split(':');
      return {
        login,
        password: passwordParts.join(':'),
      };
    })
    .filter((acc) => acc.login && acc.password);
}

async function getMaFileData(login) {
  const normalizedLogin = String(login).trim().toLowerCase();
  const candidateDirs = [
    path.join(__dirname, 'maFiles'),
    path.join(__dirname, 'mafiles'),
    path.join(__dirname, 'mafiles', 'MaFiles'),
    path.join(__dirname, 'мафайлы'),
    path.join(__dirname, 'мафайлов'),
  ];

  for (const maDir of candidateDirs) {
    try {
      const files = await fs.readdir(maDir);

      for (const fileName of files) {
        if (!fileName.endsWith('.json') && !fileName.endsWith('.maFile')) continue;

        const fullPath = path.join(maDir, fileName);
        const parsed = JSON.parse(await fs.readFile(fullPath, 'utf8'));
        const accountName = String(parsed.account_name || '').trim().toLowerCase();

        if (accountName === normalizedLogin) {
          if (!parsed.shared_secret) {
            throw new Error(`В maFile ${fileName} отсутствует shared_secret`);
          }
          if (!parsed.identity_secret) {
            throw new Error(`В maFile ${fileName} отсутствует identity_secret`);
          }

          return {
            sharedSecret: parsed.shared_secret,
            identitySecret: parsed.identity_secret,
          };
        }
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }

  throw new Error(`maFile не найден для аккаунта: ${login}`);
}

async function setCommunityCookies(community, cookies) {
  await new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      resolve();
    }, 15000);

    try {
      community.setCookies(cookies, (err) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);

        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    } catch (error) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      reject(error);
    }
  });
}

async function authorizeWithTimeout(login, password, sharedSecret, timeoutMs = 120000) {
  return Promise.race([
    authorize(login, password, sharedSecret),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`[${login}] Таймаут авторизации`)), timeoutMs);
    }),
  ]);
}

async function main() {
  const { marketHashName, targetPrice } = await askBuyInputs();
  const accounts = await readAccounts();

  for (const account of accounts) {
    let client;

    try {
      console.log(`\n🚀 [BUY] Обработка аккаунта: ${account.login} (TF2 appid=${TF2_APP_ID})`);

      const { sharedSecret, identitySecret } = await getMaFileData(account.login);
      const authResult = await authorizeWithTimeout(account.login, account.password, sharedSecret);

      client = authResult.client;

      const community = new SteamCommunity();
      await setCommunityCookies(community, authResult.cookies);
      community.steamID = client.steamID;
      community.sessionID = authResult.sessionID;

      const result = await placeBuyOrderOnFullBalance(
        community,
        TF2_APP_ID,
        marketHashName,
        targetPrice,
        identitySecret
      );

      if (result.success) {
        console.log(
          `✅ [BUY:${account.login}] quantity=${result.quantity}, unitPrice=${result.unitPrice}, remaining=${result.remainingBalance}`
        );
      } else {
        console.log(`⚠️ [BUY:${account.login}] ${result.message || result.error || 'Неуспешно'}`);
        console.log(`🧾 [BUY:${account.login}] Детали: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      console.error(`❌ [BUY:${account.login}]`, error.message || error);
    } finally {
      if (client) {
        client.logOff();
      }

      console.log('⏳ [BUY] Пауза 15 секунд перед следующим аккаунтом...');
      await sleep(15000);
    }
  }
}

main().catch((error) => {
  console.error('❌ [BUY] Критическая ошибка:', error.message || error);
});
