#!/usr/bin/env python3
"""Скрипт для сопоставления логинов Steam с паролями из базы login:password."""

from __future__ import annotations

import argparse
from pathlib import Path


def read_logins(path: Path) -> list[str]:
    """Читает логины (по одному в строке), пропуская пустые строки."""
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def read_credentials_map(path: Path) -> dict[str, str]:
    """Читает файл формата `логин:пароль` в словарь."""
    credentials: dict[str, str] = {}

    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue

        if ":" not in line:
            raise ValueError(
                f"Некорректная строка #{line_number} в файле паролей: '{raw_line}'. "
                "Ожидается формат 'логин:пароль'."
            )

        login, password = line.split(":", 1)
        login = login.strip()
        password = password.strip()

        if not login:
            raise ValueError(f"Пустой логин в строке #{line_number} файла паролей.")

        credentials[login] = password

    return credentials


def build_output_lines(logins: list[str], credentials: dict[str, str]) -> list[str]:
    """Возвращает список строк `логин:пароль` только для найденных логинов."""
    result: list[str] = []
    for login in logins:
        if login in credentials:
            result.append(f"{login}:{credentials[login]}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Берёт логины из одного файла, ищет пароли в другом файле формата "
            "'логин:пароль' и сохраняет найденные пары в выходной файл."
        )
    )
    parser.add_argument("logins_file", type=Path, help="Путь к файлу с логинами (по одному на строку).")
    parser.add_argument("passwords_file", type=Path, help="Путь к файлу с данными 'логин:пароль'.")
    parser.add_argument("output_file", type=Path, help="Куда сохранить найденные пары.")

    args = parser.parse_args()

    logins = read_logins(args.logins_file)
    credentials = read_credentials_map(args.passwords_file)
    output_lines = build_output_lines(logins, credentials)

    args.output_file.write_text("\n".join(output_lines) + ("\n" if output_lines else ""), encoding="utf-8")

    print(
        f"Готово. Найдено {len(output_lines)} из {len(logins)} логинов. "
        f"Результат записан в: {args.output_file}"
    )


if __name__ == "__main__":
    main()
