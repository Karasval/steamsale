const fs = require('fs');
const path = require('path');

const CURRENCY_SYMBOLS = {
  1: 'USD',
  2: 'GBP',
  3: 'EUR',
  4: 'CHF',
  5: 'RUB',
  6: 'PLN',
  7: 'BRL',
  8: 'JPY',
  9: 'NOK',
  10: 'IDR',
  11: 'MYR',
  12: 'PHP',
  13: 'SGD',
  14: 'THB',
  15: 'VND',
  16: 'KRW',
  17: 'TRY',
  18: 'UAH',
  19: 'MXN',
  20: 'CAD',
  21: 'AUD',
  22: 'NZD',
  23: 'CNY',
  24: 'INR',
  25: 'CLP',
  26: 'PEN',
  27: 'COP',
  28: 'ZAR',
  29: 'HKD',
  30: 'TWD',
  31: 'SAR',
  32: 'AED',
  34: 'ILS',
  35: 'BYN',
  37: 'KZT',
  38: 'KWD',
  39: 'QAR',
  40: 'CRC',
  41: 'UYU',
  9000: 'RMB'
};

function getDependency(name) {
  try {
    return require(name);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `Не найдена зависимость "${name}". Выполните:\n` +
        'npm install\n' +
        'или если используете только GUI-режим:\n' +
        `npm install ${name}`
      );
    }
    throw error;
  }
}

function resolvePath(filePath) {
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function loadMaFile(maFilePath) {
  const fullPath = resolvePath(maFilePath);

  if (!fullPath || !fs.existsSync(fullPath)) {
    throw new Error(`MaFile не найден: ${fullPath || '(путь не указан)'}`);
  }

  const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (!parsed.shared_secret) {
    throw new Error('В maFile отсутствует shared_secret');
  }

  return parsed;
}

function formatBalance(balanceInCents) {
  return (balanceInCents / 100).toFixed(2);
}

function appendResult(outputPath, resultLine) {
  fs.appendFileSync(outputPath, `${resultLine}\n`, 'utf8');
}

function normalizeWalletInfo({ hasWallet, balance, currencyCode }) {
  if (typeof hasWallet !== 'boolean') {
    throw new Error('Не удалось определить наличие кошелька Steam.');
  }

  if (!hasWallet) {
    return { hasWallet: false, balance: 0, currencyCode: 0 };
  }

  if (!Number.isFinite(balance) || !Number.isFinite(currencyCode)) {
    throw new Error('Не удалось получить корректные данные баланса/валюты.');
  }

  return {
    hasWallet,
    balance: Number(balance),
    currencyCode: Number(currencyCode)
  };
}

function parseWalletEventArgs(args) {
  if (!Array.isArray(args) || args.length < 3) {
    throw new Error('Steam вернул неизвестный формат wallet-события.');
  }

  const hasWallet = Boolean(args[0]);
  const second = Number(args[1]);
  const third = Number(args[2]);

  if (!Number.isFinite(second) || !Number.isFinite(third)) {
    throw new Error('Steam вернул некорректные числовые значения wallet-события.');
  }

  // В разных версиях steam-user порядок полей отличается:
  // (hasWallet, balance, currencyCode) или (hasWallet, currencyCode, balance)
  const secondLooksCurrency = second > 0 && second < 10000 && !!CURRENCY_SYMBOLS[second];
  const thirdLooksCurrency = third > 0 && third < 10000 && !!CURRENCY_SYMBOLS[third];

  if (secondLooksCurrency && !thirdLooksCurrency) {
    return normalizeWalletInfo({ hasWallet, balance: third, currencyCode: second });
  }

  if (thirdLooksCurrency && !secondLooksCurrency) {
    return normalizeWalletInfo({ hasWallet, balance: second, currencyCode: third });
  }

  // fallback: старое поведение
  return normalizeWalletInfo({ hasWallet, balance: second, currencyCode: third });
}

function getWalletFromProperty(client) {
  const wallet = client && client.wallet;
  if (!wallet || typeof wallet !== 'object') {
    return null;
  }

  const hasWallet = typeof wallet.hasWallet === 'boolean' ? wallet.hasWallet : null;
  const balance = Number(wallet.balance);
  const currencyCode = Number(wallet.currencyCode || wallet.currency);

  if (hasWallet === null || !Number.isFinite(balance) || !Number.isFinite(currencyCode)) {
    return null;
  }

  return normalizeWalletInfo({ hasWallet, balance, currencyCode });
}

function getWalletViaMethod(client) {
  return new Promise((resolve, reject) => {
    client.getWalletBalance((hasWallet, balance, currencyCode) => {
      try {
        resolve(normalizeWalletInfo({ hasWallet, balance, currencyCode }));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function getWalletViaEvent(client, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Не дождались wallet-события от Steam. Попробуйте снова.'));
    }, timeoutMs);

    const onWallet = (...args) => {
      cleanup();
      try {
        resolve(parseWalletEventArgs(args));
      } catch (error) {
        reject(error);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      client.off('wallet', onWallet);
    };

    client.on('wallet', onWallet);
  });
}

async function readWalletInfo(client) {
  if (typeof client.getWalletBalance === 'function') {
    return getWalletViaMethod(client);
  }

  const fromProperty = getWalletFromProperty(client);
  if (fromProperty) {
    return fromProperty;
  }

  return getWalletViaEvent(client);
}

async function fetchSteamBalance({ login, password, maFilePath, outputFilePath }) {
  if (!login || !password || !maFilePath || !outputFilePath) {
    throw new Error('Нужны login, password, maFilePath и outputFilePath');
  }

  const SteamUser = getDependency('steam-user');
  const SteamTotp = getDependency('steam-totp');

  const maData = loadMaFile(maFilePath);
  const twoFactorCode = SteamTotp.generateAuthCode(maData.shared_secret);
  const client = new SteamUser();

  const result = await new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    client.on('error', (err) => {
      finish(new Error(`Ошибка Steam-клиента: ${err.message || err}`));
    });

    client.on('loggedOn', async () => {
      try {
        const walletInfo = await readWalletInfo(client);

        if (!walletInfo.hasWallet) {
          finish(new Error('У аккаунта отсутствует Steam-кошелёк'));
          client.logOff();
          return;
        }

        const currency = CURRENCY_SYMBOLS[walletInfo.currencyCode] || `UNKNOWN(${walletInfo.currencyCode})`;
        const formattedBalance = formatBalance(walletInfo.balance);
        const timestamp = new Date().toISOString();
        const line = `${timestamp} | login=${login} | balance=${formattedBalance} | currency=${currency}`;

        appendResult(resolvePath(outputFilePath), line);
        finish(null, { line, outputFilePath: resolvePath(outputFilePath) });
      } catch (error) {
        finish(error);
      } finally {
        client.logOff();
      }
    });

    client.logOn({
      accountName: login,
      password,
      twoFactorCode
    });
  });

  return result;
}

function parseCredentialsFile(credentialsPath) {
  const fullPath = resolvePath(credentialsPath);
  if (!fullPath || !fs.existsSync(fullPath)) {
    throw new Error(`Файл с логином/паролем не найден: ${fullPath || '(путь не указан)'}`);
  }

  const raw = fs.readFileSync(fullPath, 'utf8').trim();
  if (!raw) {
    throw new Error('Файл с логином/паролем пустой');
  }

  try {
    const json = JSON.parse(raw);
    if (json.login && json.password) {
      return { login: String(json.login), password: String(json.password) };
    }
  } catch (err) {
    // ignore: not JSON, fallback parsers below
  }

  const loginMatch = raw.match(/^\s*login\s*[:=]\s*(.+)$/im);
  const passwordMatch = raw.match(/^\s*password\s*[:=]\s*(.+)$/im);
  if (loginMatch && passwordMatch) {
    return {
      login: loginMatch[1].trim(),
      password: passwordMatch[1].trim()
    };
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return {
      login: lines[0],
      password: lines[1]
    };
  }

  throw new Error('Не удалось распарсить файл логина/пароля. Поддержка: JSON, login=/password=, или 2 строки.');
}

module.exports = {
  fetchSteamBalance,
  parseCredentialsFile,
  resolvePath,
  getDependency,
  readWalletInfo,
  parseWalletEventArgs
};
