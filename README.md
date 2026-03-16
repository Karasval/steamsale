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

## Подготовка

1. Скопируйте пример env:
   ```bash
   cp .env.example .env
   ```
2. Заполните `.env`:
   - `STEAM_LOGIN`
   - `STEAM_PASSWORD`
   - `STEAM_MAFILE` — путь до вашего `.maFile`
   - `OUTPUT_FILE` — куда записывать результат

## Запуск

```bash
npm start
```

или напрямую:

```bash
node steam-balance.js
```

После запуска строка вида

```text
2026-01-01T10:00:00.000Z | login=example | balance=123.45 | currency=RUB
```

будет добавлена в `OUTPUT_FILE`.
