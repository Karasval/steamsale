#!/usr/bin/env python3
"""Скрипт для сопоставления логинов Steam с паролями из базы login:password."""

from __future__ import annotations

import argparse
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox


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


def process_files(logins_file: Path, passwords_file: Path, output_file: Path) -> tuple[int, int]:
    """Обрабатывает файлы и возвращает (найдено, всего логинов)."""
    logins = read_logins(logins_file)
    credentials = read_credentials_map(passwords_file)
    output_lines = build_output_lines(logins, credentials)
    output_file.write_text("\n".join(output_lines) + ("\n" if output_lines else ""), encoding="utf-8")
    return len(output_lines), len(logins)


def run_gui() -> None:
    """Запускает графический интерфейс выбора файлов."""
    root = tk.Tk()
    root.title("Steam Credentials Merge")
    root.resizable(False, False)

    logins_var = tk.StringVar()
    passwords_var = tk.StringVar()
    output_var = tk.StringVar()

    def choose_input(target: tk.StringVar) -> None:
        selected = filedialog.askopenfilename(title="Выберите текстовый файл")
        if selected:
            target.set(selected)

    def choose_output() -> None:
        selected = filedialog.asksaveasfilename(
            title="Сохранить результат как",
            defaultextension=".txt",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        )
        if selected:
            output_var.set(selected)

    def process() -> None:
        logins_path = logins_var.get().strip()
        passwords_path = passwords_var.get().strip()
        output_path = output_var.get().strip()

        if not logins_path or not passwords_path or not output_path:
            messagebox.showerror("Ошибка", "Выберите все 3 файла: логины, пароли и выходной файл.")
            return

        try:
            found, total = process_files(Path(logins_path), Path(passwords_path), Path(output_path))
        except Exception as exc:
            messagebox.showerror("Ошибка", str(exc))
            return

        messagebox.showinfo("Готово", f"Найдено {found} из {total} логинов.\nРезультат: {output_path}")

    def add_row(row: int, label: str, variable: tk.StringVar, callback) -> None:
        tk.Label(root, text=label, anchor="w").grid(row=row, column=0, padx=8, pady=6, sticky="w")
        tk.Entry(root, textvariable=variable, width=55).grid(row=row, column=1, padx=8, pady=6)
        tk.Button(root, text="Выбрать", command=callback, width=12).grid(row=row, column=2, padx=8, pady=6)

    add_row(0, "Файл с логинами:", logins_var, lambda: choose_input(logins_var))
    add_row(1, "Файл с парами логин:пароль:", passwords_var, lambda: choose_input(passwords_var))
    add_row(2, "Выходной файл:", output_var, choose_output)

    tk.Button(root, text="Запустить", command=process, width=20).grid(row=3, column=0, columnspan=3, pady=(8, 12))

    root.mainloop()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Берёт логины из одного файла, ищет пароли в другом файле формата "
            "'логин:пароль' и сохраняет найденные пары в выходной файл."
        )
    )
    parser.add_argument("logins_file", nargs="?", type=Path, help="Путь к файлу с логинами (по одному на строку).")
    parser.add_argument("passwords_file", nargs="?", type=Path, help="Путь к файлу с данными 'логин:пароль'.")
    parser.add_argument("output_file", nargs="?", type=Path, help="Куда сохранить найденные пары.")
    parser.add_argument("--gui", action="store_true", help="Открыть окно выбора файлов.")

    args = parser.parse_args()

    if args.gui or not (args.logins_file and args.passwords_file and args.output_file):
        run_gui()
        return

    found, total = process_files(args.logins_file, args.passwords_file, args.output_file)
    print(f"Готово. Найдено {found} из {total} логинов. Результат записан в: {args.output_file}")


if __name__ == "__main__":
    main()
