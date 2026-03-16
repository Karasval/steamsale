# Steam Balance Parser

Node.js-скрипт, который:
1. Логинится в Steam по логину/паролю.
2. Генерирует 2FA-код из `maFile`.
3. Получает баланс кошелька и код валюты.
4. Записывает результат в текстовый файл.

## Установка

```bash
npm install
```

Если видите ошибку `Cannot find module 'steam-user'` или другой пакет — значит зависимости не установлены.
Запустите:

```bash
npm install
```


## Если ошибка `TypeError: client.getWalletBalance is not a function`

Это из-за различий API в версиях `steam-user`.
В этой версии скрипта уже добавлен fallback: если метода нет, баланс берётся через `wallet`-событие/свойство клиента.

Что сделать:
1. Обновить проект до последнего состояния файлов.
2. Переустановить зависимости:

```bash
npm install
```

3. Запустить снова `npm start` или `npm run gui`.

## Вариант 1: запуск через `.env`

1. Скопируйте пример env:
   ```bash
   cp .env.example .env
   ```
2. Заполните `.env`:
   - `STEAM_LOGIN`
   - `STEAM_PASSWORD`
   - `STEAM_MAFILE` — путь до вашего `.maFile`
   - `OUTPUT_FILE` — куда записывать результат

Запуск:

```bash
npm start
```

## Вариант 2: упрощённый GUI-запуск (выбор файлов через окно)

Запуск:

```bash
npm run gui
```

Дальше скрипт попросит выбрать 3 файла/пути через GUI-окна:
1. Файл с логином/паролем.
2. `maFile` аккаунта.
3. Куда сохранить результат (`.txt`).

### Формат файла логин/пароль

Поддерживаются 3 формата:

1. JSON:
```json
{"login":"my_login","password":"my_password"}
```

2. Ключи в тексте:
```text
login=my_login
password=my_password
```

3. Просто 2 строки:
```text
my_login
my_password
```

После запуска строка вида

```text
2026-01-01T10:00:00.000Z | login=example | balance=123.45 | currency=RUB
```

будет добавлена в выбранный выходной файл.
