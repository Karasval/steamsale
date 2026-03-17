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
    parser.add_argument("login", nargs="?", help="Steam логин (например, account_name в maFile)")
    parser.add_argument("source_dir", nargs="?", type=Path, help="Папка, где лежат maFiles")
    parser.add_argument("destination_dir", nargs="?", type=Path, help="Папка, куда нужно скопировать найденный maFile")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Перезаписать файл в destination_dir, если он уже существует",
    )
    parser.add_argument(
        "--gui",
        action="store_true",
        help="Открыть GUI для выбора логина, папок и .maFile",
    )
    parser.add_argument(
        "--logins-file",
        type=Path,
        help="Путь к txt файлу со списком логинов (по одному логину на строку)",
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


def read_logins_file(logins_file: Path) -> list[str]:
    if not logins_file.exists() or not logins_file.is_file():
        raise FileNotFoundError(f"Файл со списком логинов не найден: {logins_file}")

    logins: list[str] = []
    for line in logins_file.read_text(encoding="utf-8").splitlines():
        login = line.strip()
        if login:
            logins.append(login)

    if not logins:
        raise ValueError(f"Файл {logins_file} не содержит логинов")

    return logins


def copy_mafiles_for_logins(logins: list[str], source_dir: Path, destination_dir: Path, overwrite: bool) -> list[Path]:
    copied_files: list[Path] = []
    for login in logins:
        mafile = find_mafile_by_login(login, source_dir)
        copied_files.append(copy_mafile(mafile, destination_dir, overwrite=overwrite))
    return copied_files


def validate_mafile_login(mafile: Path, login: str) -> None:
    try:
        data = json.loads(mafile.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError(f"Файл {mafile} не является корректным .maFile JSON") from None

    file_login = extract_login(data)
    if not file_login:
        raise ValueError(f"В файле {mafile} не найден login (account_name или Session.SteamLogin)")

    if file_login.casefold() != login.casefold():
        raise ValueError(f"Логин в файле '{file_login}' не совпадает с указанным '{login}'")


def run_gui() -> int:
    import tkinter as tk
    from tkinter import filedialog, messagebox

    try:
        root = tk.Tk()
    except tk.TclError as exc:
        print(f"Ошибка GUI: {exc}. Запустите скрипт в окружении с графическим интерфейсом или используйте CLI режим.", file=sys.stderr)
        return 2
    root.title("Steam maFile Copier")
    root.resizable(False, False)

    login_var = tk.StringVar()
    source_dir_var = tk.StringVar()
    destination_dir_var = tk.StringVar()
    mafile_var = tk.StringVar()
    logins_file_var = tk.StringVar()
    overwrite_var = tk.BooleanVar(value=False)

    def choose_source_dir() -> None:
        directory = filedialog.askdirectory(title="Выберите папку с maFiles")
        if directory:
            source_dir_var.set(directory)

    def choose_destination_dir() -> None:
        directory = filedialog.askdirectory(title="Выберите папку назначения")
        if directory:
            destination_dir_var.set(directory)

    def choose_mafile() -> None:
        filepath = filedialog.askopenfilename(
            title="Выберите .maFile",
            filetypes=[("Steam maFile", "*.maFile"), ("All files", "*.*")],
        )
        if filepath:
            mafile_var.set(filepath)

    def choose_logins_file() -> None:
        filepath = filedialog.askopenfilename(
            title="Выберите txt файл с логинами",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        )
        if filepath:
            logins_file_var.set(filepath)

    def execute_copy() -> None:
        login = login_var.get().strip()
        destination = destination_dir_var.get().strip()
        source_dir = source_dir_var.get().strip()
        mafile = mafile_var.get().strip()
        logins_file = logins_file_var.get().strip()

        if not destination:
            messagebox.showerror("Ошибка", "Выберите папку назначения")
            return

        if not login and not mafile and not logins_file:
            messagebox.showerror("Ошибка", "Укажите логин, выберите .maFile или txt со списком логинов")
            return

        try:
            if mafile:
                source_file = Path(mafile)
                if not source_file.exists() or not source_file.is_file():
                    raise FileNotFoundError(f"Файл не найден: {source_file}")
                if login:
                    validate_mafile_login(source_file, login)
                copied_to = copy_mafile(source_file, Path(destination), overwrite=overwrite_var.get())
                messagebox.showinfo("Успех", f"Найден файл: {source_file}\nСкопирован в: {copied_to}")
                return
            if logins_file:
                if not source_dir:
                    raise FileNotFoundError("Выберите папку с maFiles")
                logins = read_logins_file(Path(logins_file))
                copied_files = copy_mafiles_for_logins(
                    logins=logins,
                    source_dir=Path(source_dir),
                    destination_dir=Path(destination),
                    overwrite=overwrite_var.get(),
                )
                messagebox.showinfo(
                    "Успех",
                    f"Скопировано файлов: {len(copied_files)}\nПапка назначения: {destination}",
                )
                return
            else:
                if not source_dir:
                    raise FileNotFoundError("Выберите папку с maFiles")
                source_file = find_mafile_by_login(login, Path(source_dir))
                copied_to = copy_mafile(source_file, Path(destination), overwrite=overwrite_var.get())
                messagebox.showinfo("Успех", f"Найден файл: {source_file}\nСкопирован в: {copied_to}")
                return
        except (FileNotFoundError, FileExistsError, ValueError) as exc:
            messagebox.showerror("Ошибка", str(exc))
            return

    pad = {"padx": 8, "pady": 4}

    tk.Label(root, text="Steam логин (необязательно, если выбрали файл):").grid(row=0, column=0, sticky="w", **pad)
    tk.Entry(root, textvariable=login_var, width=45).grid(row=1, column=0, columnspan=2, sticky="we", **pad)

    tk.Label(root, text="Папка с maFiles (для поиска по логину):").grid(row=2, column=0, sticky="w", **pad)
    tk.Entry(root, textvariable=source_dir_var, width=45).grid(row=3, column=0, sticky="we", **pad)
    tk.Button(root, text="Выбрать папку", command=choose_source_dir).grid(row=3, column=1, **pad)

    tk.Label(root, text="Или выберите конкретный .maFile:").grid(row=4, column=0, sticky="w", **pad)
    tk.Entry(root, textvariable=mafile_var, width=45).grid(row=5, column=0, sticky="we", **pad)
    tk.Button(root, text="Выбрать файл", command=choose_mafile).grid(row=5, column=1, **pad)

    tk.Label(root, text="Или выберите txt файл с логинами:").grid(row=6, column=0, sticky="w", **pad)
    tk.Entry(root, textvariable=logins_file_var, width=45).grid(row=7, column=0, sticky="we", **pad)
    tk.Button(root, text="Выбрать txt", command=choose_logins_file).grid(row=7, column=1, **pad)

    tk.Label(root, text="Папка назначения:").grid(row=8, column=0, sticky="w", **pad)
    tk.Entry(root, textvariable=destination_dir_var, width=45).grid(row=9, column=0, sticky="we", **pad)
    tk.Button(root, text="Выбрать папку", command=choose_destination_dir).grid(row=9, column=1, **pad)

    tk.Checkbutton(root, text="Перезаписать, если файл уже существует", variable=overwrite_var).grid(
        row=10, column=0, columnspan=2, sticky="w", **pad
    )
    tk.Button(root, text="Копировать", command=execute_copy, width=20).grid(row=11, column=0, columnspan=2, pady=10)

    root.mainloop()
    return 0


def run_cli(args: argparse.Namespace) -> int:
    if args.logins_file:
        source_dir = args.source_dir
        destination_dir = args.destination_dir

        if args.login and args.source_dir and not args.destination_dir:
            source_dir = Path(args.login)
            destination_dir = args.source_dir

        if not source_dir or not destination_dir:
            print(
                "Ошибка: для --logins-file нужны source_dir и destination_dir.\n"
                "Пример: script.py --logins-file logins.txt ./mafiles ./out",
                file=sys.stderr,
            )
            return 2

        try:
            logins = read_logins_file(args.logins_file)
            copied_files = copy_mafiles_for_logins(logins, source_dir, destination_dir, overwrite=args.overwrite)
        except (FileNotFoundError, FileExistsError, ValueError) as exc:
            print(f"Ошибка: {exc}", file=sys.stderr)
            return 1
        print(f"Скопировано файлов: {len(copied_files)}")
        print(f"Папка назначения: {destination_dir}")
        return 0

    if not args.login or not args.source_dir or not args.destination_dir:
        print(
            "Ошибка: для CLI режима нужны аргументы: login source_dir destination_dir\n"
            "Либо используйте --logins-file, либо запустите с --gui.",
            file=sys.stderr,
        )
        return 2

    try:
        mafile = find_mafile_by_login(args.login, args.source_dir)
        copied_to = copy_mafile(mafile, args.destination_dir, overwrite=args.overwrite)
    except (FileNotFoundError, FileExistsError) as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 1

    print(f"Найден файл: {mafile}")
    print(f"Скопирован в: {copied_to}")
    return 0


def main() -> int:
    args = parse_args()
    if args.gui or (not args.login and not args.source_dir and not args.destination_dir and not args.logins_file):
        return run_gui()
    return run_cli(args)


if __name__ == "__main__":
    raise SystemExit(main())
