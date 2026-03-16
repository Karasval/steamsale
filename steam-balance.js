#!/usr/bin/env node

require('dotenv').config();
const { fetchSteamBalance, resolvePath } = require('./steam-balance-core');

async function main() {
  const login = process.env.STEAM_LOGIN;
  const password = process.env.STEAM_PASSWORD;
  const maFilePath = process.env.STEAM_MAFILE;
  const outputFilePath = resolvePath(process.env.OUTPUT_FILE || './steam-balance-results.txt');

  if (!login || !password || !maFilePath) {
    throw new Error('Заполните STEAM_LOGIN, STEAM_PASSWORD и STEAM_MAFILE в .env');
  }

  const result = await fetchSteamBalance({ login, password, maFilePath, outputFilePath });
  console.log('Баланс получен успешно:');
  console.log(result.line);
  console.log(`Результат записан в: ${result.outputFilePath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
