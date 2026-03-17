const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const SteamCommunity = require('steamcommunity');

const { authorize } = require('./auth');
const { sellItem } = require('./market');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askUserInputs() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const itemName = await new Promise((resolve) => {
      rl.question('Введите точное название предмета: ', resolve);
    });

    const targetPrice = await new Promise((resolve) => {
      rl.question('Введите цену продажи: ', resolve);
    });

    return {
      itemName: itemName.trim(),
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

  // Поддерживаем несколько популярных названий папки с maFile.
  const candidateDirs = [
    path.join(__dirname, 'maFiles'),
    path.join(__dirname, 'mafiles'),
    path.join(__dirname, 'mafiles', 'MaFiles'),
    path.join(__dirname, 'мафайлы'),
    path.join(__dirname, 'мафайлов'),
  ];

  let checkedDirs = [];

  for (const maDir of candidateDirs) {
    try {
      const files = await fs.readdir(maDir);
      checkedDirs.push(maDir);

      for (const fileName of files) {
        // Берем любые потенциальные maFile, не только .json
        if (!fileName.endsWith('.json') && !fileName.endsWith('.maFile')) continue;

        const fullPath = path.join(maDir, fileName);
        const parsed = JSON.parse(await fs.readFile(fullPath, 'utf8'));

        const accountName = String(parsed.account_name || '').trim().toLowerCase();
        if (accountName === normalizedLogin) {
          if (!parsed.shared_secret || !parsed.identity_secret) {
            throw new Error(`В maFile ${fileName} нет shared_secret или identity_secret`);
          }

          return {
            sharedSecret: parsed.shared_secret,
            identitySecret: parsed.identity_secret,
          };
        }
      }
    } catch (error) {
      // Игнорируем отсутствующие папки и продолжаем поиск в следующих.
      if (error && error.code === 'ENOENT') {
        continue;
      }

      // Для JSON-ошибок и прочего сразу падаем, чтобы не скрывать реальные проблемы.
      throw error;
    }
  }

  throw new Error(
    `maFile не найден для аккаунта: ${login}. Проверены папки: ${checkedDirs.join(', ') || 'нет доступных'}`
  );
}


async function setCommunityCookies(community, cookies) {
  await new Promise((resolve, reject) => {
    community.setCookies(cookies, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const { itemName, targetPrice } = await askUserInputs();
  const accounts = await readAccounts();

  for (const account of accounts) {
    let client;

    try {
      console.log(`\n🚀 Обработка аккаунта: ${account.login}`);

      const { sharedSecret, identitySecret } = await getMaFileData(account.login);
      const authResult = await authorize(account.login, account.password, sharedSecret);

      client = authResult.client;

      const community = new SteamCommunity();
      await setCommunityCookies(community, authResult.cookies);

      const result = await sellItem(
        community,
        itemName,
        targetPrice,
        identitySecret,
        730,
        2
      );

      console.log(`📌 Результат [${account.login}]: ${result ? 'успех' : 'неуспех'}`);
    } catch (error) {
      console.error(`❌ Ошибка аккаунта [${account.login}]:`, error.message || error);
    } finally {
      if (client) {
        client.logOff();
      }

      console.log('⏳ Пауза 15 секунд перед следующим аккаунтом...');
      await sleep(15000);
    }
  }
}

main().catch((error) => {
  console.error('❌ Критическая ошибка:', error.message || error);
});
