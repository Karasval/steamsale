#!/usr/bin/env node

const path = require('path');
const { parseCredentialsFile, fetchSteamBalance, getDependency } = require('./steam-balance-core');

async function main() {
  const dialog = getDependency('node-file-dialog');

  const [credentialsPath] = await dialog({
    type: 'open-file',
    title: 'Выберите файл с логином/паролем'
  });

  const [maFilePath] = await dialog({
    type: 'open-file',
    title: 'Выберите maFile (.maFile/.json)'
  });

  const [outputFilePath] = await dialog({
    type: 'save-file',
    title: 'Выберите куда сохранить результат',
    defaultPath: path.join(process.cwd(), 'steam-balance-results.txt')
  });

  const { login, password } = parseCredentialsFile(credentialsPath);

  const result = await fetchSteamBalance({
    login,
    password,
    maFilePath,
    outputFilePath
  });

  console.log('Баланс получен успешно (GUI режим):');
  console.log(result.line);
  console.log(`Результат записан в: ${result.outputFilePath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
