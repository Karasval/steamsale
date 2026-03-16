# Steam Balance Parser (Java)

Скрипт логинится в Steam по `login + password + maFile`, получает баланс кошелька и ID валюты, после чего записывает результат в текстовый файл.

## Запуск

```bash
javac SteamBalanceParser.java
java SteamBalanceParser <login> <password> <path_to_mafile> <output_txt>
```

Пример:

```bash
java SteamBalanceParser my_login my_password ./maFiles/account.maFile ./result.txt
```

## Формат результата

В `output_txt` будет записана строка вида:

```text
login=my_login; balance=$12.34; currency_id=1; currency=USD
```
