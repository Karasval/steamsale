const fs = require('fs');
const path = require('path');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');

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

async function fetchSteamBalance({ login, password, maFilePath, outputFilePath }) {
  if (!login || !password || !maFilePath || !outputFilePath) {
    throw new Error('Нужны login, password, maFilePath и outputFilePath');
  }

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

    client.on('loggedOn', () => {
      client.getWalletBalance((hasWallet, balance, currencyCode) => {
        if (!hasWallet) {
          finish(new Error('У аккаунта отсутствует Steam-кошелёк'));
          client.logOff();
          return;
        }

        const currency = CURRENCY_SYMBOLS[currencyCode] || `UNKNOWN(${currencyCode})`;
        const formattedBalance = formatBalance(balance);
        const timestamp = new Date().toISOString();
        const line = `${timestamp} | login=${login} | balance=${formattedBalance} | currency=${currency}`;

        appendResult(resolvePath(outputFilePath), line);
        finish(null, { line, outputFilePath: resolvePath(outputFilePath) });
        client.logOff();
      });
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
  resolvePath
};
