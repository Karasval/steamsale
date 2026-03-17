#!/usr/bin/env python3
"""Find a Steam Desktop Authenticator .maFile by login and copy it to another directory."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Находит .maFile по Steam-логину и копирует его в другую папку.",
    )
    parser.add_argument(
        "login",
        help="Steam логин (например, account_name в maFile)",
    )
    parser.add_argument(
        "source_dir",
        type=Path,
        help="Папка, где лежат maFiles",
    )
    parser.add_argument(
        "destination_dir",
        type=Path,
        help="Папка, куда нужно скопировать найденный maFile",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Перезаписать файл в destination_dir, если он уже существует",
    )
    return parser.parse_args()


def extract_login(mafile_data: dict) -> str | None:
    account_name = mafile_data.get("account_name")
    if isinstance(account_name, str) and account_name.strip():
        return account_name.strip()

    session = mafile_data.get("Session")
    if isinstance(session, dict):
        steam_login = session.get("SteamLogin")
        if isinstance(steam_login, str) and steam_login.strip():
            return steam_login.strip()

    return None


def find_mafile_by_login(login: str, source_dir: Path) -> Path:
    target_login = login.casefold()

    if not source_dir.exists() or not source_dir.is_dir():
        raise FileNotFoundError(f"Папка source_dir не найдена или не является директорией: {source_dir}")

    for candidate in sorted(source_dir.glob("*.maFile")):
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue

        file_login = extract_login(data)
        if file_login and file_login.casefold() == target_login:
            return candidate

    raise FileNotFoundError(f"Не найден .maFile для логина '{login}' в папке: {source_dir}")


def copy_mafile(source_file: Path, destination_dir: Path, overwrite: bool) -> Path:
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination_file = destination_dir / source_file.name

    if destination_file.exists() and not overwrite:
        raise FileExistsError(
            f"Файл уже существует: {destination_file}. Используйте --overwrite для перезаписи."
        )

    shutil.copy2(source_file, destination_file)
    return destination_file


def main() -> int:
    args = parse_args()

    try:
        mafile = find_mafile_by_login(args.login, args.source_dir)
        copied_to = copy_mafile(mafile, args.destination_dir, overwrite=args.overwrite)
    except (FileNotFoundError, FileExistsError) as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 1

    print(f"Найден файл: {mafile}")
    print(f"Скопирован в: {copied_to}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
