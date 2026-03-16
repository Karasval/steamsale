#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
require('dotenv').config();

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
  if (!filePath) {
    return '';
  }
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function loadMaFile(maFilePath) {
  const fullPath = resolvePath(maFilePath);

  if (!fullPath || !fs.existsSync(fullPath)) {
    throw new Error(`MaFile не найден: ${fullPath || '(путь не указан)'}`);
  }

  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(raw);

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

async function main() {
  const login = process.env.STEAM_LOGIN;
  const password = process.env.STEAM_PASSWORD;
  const maFile = process.env.STEAM_MAFILE;
  const outputFile = resolvePath(process.env.OUTPUT_FILE || './steam-balance-results.txt');

  if (!login || !password || !maFile) {
    throw new Error('Заполните STEAM_LOGIN, STEAM_PASSWORD и STEAM_MAFILE в .env');
  }

  const maData = loadMaFile(maFile);
  const twoFactorCode = SteamTotp.generateAuthCode(maData.shared_secret);

  const client = new SteamUser();

  await new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
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

        const result = `${timestamp} | login=${login} | balance=${formattedBalance} | currency=${currency}`;
        appendResult(outputFile, result);

        console.log('Баланс получен успешно:');
        console.log(result);
        console.log(`Результат записан в: ${outputFile}`);

        finish();
        client.logOff();
      });
    });

    client.logOn({
      accountName: login,
      password,
      twoFactorCode
    });
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
