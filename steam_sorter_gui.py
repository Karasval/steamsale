import json
import shutil
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox
from tkinter.scrolledtext import ScrolledText


class SteamSorterApp:
    """GUI-приложение для локальной сортировки .maFile и базы аккаунтов."""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("SteamID локальный сортировщик")
        self.root.geometry("850x560")

        # Пути к выбранным пользователем данным
        self.steamid_file_path: Path | None = None
        self.mafiles_dir_path: Path | None = None
        self.accounts_file_path: Path | None = None

        self._build_ui()

    def _build_ui(self) -> None:
        """Создание элементов интерфейса."""
        controls_frame = tk.Frame(self.root, padx=10, pady=10)
        controls_frame.pack(fill=tk.X)

        self.btn_select_steamids = tk.Button(
            controls_frame,
            text="1) Выбрать файл со SteamID",
            command=self.select_steamid_file,
            width=35,
        )
        self.btn_select_steamids.grid(row=0, column=0, sticky="w", padx=5, pady=5)

        self.lbl_steamids = tk.Label(controls_frame, text="Файл не выбран", anchor="w")
        self.lbl_steamids.grid(row=0, column=1, sticky="ew", padx=5)

        self.btn_select_mafiles = tk.Button(
            controls_frame,
            text="2) Выбрать папку с maFiles",
            command=self.select_mafiles_dir,
            width=35,
        )
        self.btn_select_mafiles.grid(row=1, column=0, sticky="w", padx=5, pady=5)

        self.lbl_mafiles = tk.Label(controls_frame, text="Папка не выбрана", anchor="w")
        self.lbl_mafiles.grid(row=1, column=1, sticky="ew", padx=5)

        self.btn_select_accounts = tk.Button(
            controls_frame,
            text="3) Выбрать базу аккаунтов",
            command=self.select_accounts_file,
            width=35,
        )
        self.btn_select_accounts.grid(row=2, column=0, sticky="w", padx=5, pady=5)

        self.lbl_accounts = tk.Label(controls_frame, text="Файл не выбран", anchor="w")
        self.lbl_accounts.grid(row=2, column=1, sticky="ew", padx=5)

        self.btn_start = tk.Button(
            controls_frame,
            text="4) Начать сортировку",
            command=self.start_sorting,
            bg="#2f9e44",
            fg="white",
            width=35,
        )
        self.btn_start.grid(row=3, column=0, sticky="w", padx=5, pady=(10, 5))

        controls_frame.columnconfigure(1, weight=1)

        log_frame = tk.Frame(self.root, padx=10, pady=10)
        log_frame.pack(fill=tk.BOTH, expand=True)

        tk.Label(log_frame, text="5) Логи работы:").pack(anchor="w")

        self.log_text = ScrolledText(log_frame, wrap=tk.WORD, height=20, state=tk.DISABLED)
        self.log_text.pack(fill=tk.BOTH, expand=True, pady=(5, 0))

    def log(self, message: str) -> None:
        """Безопасный вывод логов в текстовое поле из любого потока."""

        def append() -> None:
            self.log_text.config(state=tk.NORMAL)
            self.log_text.insert(tk.END, message + "\n")
            self.log_text.see(tk.END)
            self.log_text.config(state=tk.DISABLED)

        self.root.after(0, append)

    def set_controls_state(self, enabled: bool) -> None:
        """Включение/выключение кнопок во время обработки."""
        state = tk.NORMAL if enabled else tk.DISABLED

        def apply_state() -> None:
            self.btn_select_steamids.config(state=state)
            self.btn_select_mafiles.config(state=state)
            self.btn_select_accounts.config(state=state)
            self.btn_start.config(state=state)

        self.root.after(0, apply_state)

    def select_steamid_file(self) -> None:
        path = filedialog.askopenfilename(
            title="Выберите txt файл со SteamID",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        )
        if path:
            self.steamid_file_path = Path(path)
            self.lbl_steamids.config(text=str(self.steamid_file_path))
            self.log(f"Выбран файл SteamID: {self.steamid_file_path}")

    def select_mafiles_dir(self) -> None:
        path = filedialog.askdirectory(title="Выберите папку с .maFile")
        if path:
            self.mafiles_dir_path = Path(path)
            self.lbl_mafiles.config(text=str(self.mafiles_dir_path))
            self.log(f"Выбрана папка maFiles: {self.mafiles_dir_path}")

    def select_accounts_file(self) -> None:
        path = filedialog.askopenfilename(
            title="Выберите txt файл с базой аккаунтов",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        )
        if path:
            self.accounts_file_path = Path(path)
            self.lbl_accounts.config(text=str(self.accounts_file_path))
            self.log(f"Выбран файл базы аккаунтов: {self.accounts_file_path}")

    def start_sorting(self) -> None:
        """Запуск сортировки в отдельном потоке, чтобы GUI не зависал."""
        if not self.steamid_file_path or not self.steamid_file_path.exists():
            messagebox.showerror("Ошибка", "Сначала выберите корректный файл со SteamID.")
            return

        if not self.mafiles_dir_path or not self.mafiles_dir_path.exists():
            messagebox.showerror("Ошибка", "Сначала выберите корректную папку с maFiles.")
            return

        if not self.accounts_file_path or not self.accounts_file_path.exists():
            messagebox.showerror("Ошибка", "Сначала выберите корректный файл базы аккаунтов.")
            return

        worker = threading.Thread(target=self.run_sorting, daemon=True)
        worker.start()

    def run_sorting(self) -> None:
        """Основная логика сортировки."""
        self.set_controls_state(False)
        self.log("=" * 70)
        self.log("Старт сортировки...")

        try:
            # 1) Загрузка SteamID в set для быстрого поиска O(1)
            steam_ids = self.load_steam_ids(self.steamid_file_path)
            self.log(f"Загружено SteamID: {len(steam_ids)}")

            # 2) Парсинг .maFile и подготовка папки с результатами
            filtered_mafiles_dir = self.mafiles_dir_path.parent / "Filtered_maFiles"
            filtered_mafiles_dir.mkdir(exist_ok=True)
            self.log(f"Папка для отфильтрованных maFile: {filtered_mafiles_dir}")

            # 3) Сопоставление SteamID и сбор целевых логинов
            target_logins, copied_count = self.process_mafiles(
                steam_ids=steam_ids,
                source_dir=self.mafiles_dir_path,
                target_dir=filtered_mafiles_dir,
            )
            self.log(f"Скопировано maFile: {copied_count}")
            self.log(f"Собрано целевых логинов: {len(target_logins)}")

            # 4-5) Фильтрация базы аккаунтов по собранным логинам
            filtered_accounts_path = self.accounts_file_path.parent / "Filtered_accounts.txt"
            written_count = self.filter_accounts_db(
                accounts_file=self.accounts_file_path,
                target_logins=target_logins,
                output_file=filtered_accounts_path,
            )

            self.log(f"Записано строк в Filtered_accounts.txt: {written_count}")
            self.log(f"Готово. Файл: {filtered_accounts_path}")
            self.log("Сортировка успешно завершена.")

        except Exception as exc:
            self.log(f"Критическая ошибка: {exc}")
            messagebox.showerror("Ошибка", f"Во время работы произошла ошибка:\n{exc}")
        finally:
            self.set_controls_state(True)
            self.log("=" * 70)

    def load_steam_ids(self, file_path: Path) -> set[str]:
        """Читает txt со SteamID и возвращает множество значений."""
        steam_ids: set[str] = set()
        with file_path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                steam_id = line.strip()
                if steam_id:
                    steam_ids.add(steam_id)
        return steam_ids

    def process_mafiles(self, steam_ids: set[str], source_dir: Path, target_dir: Path) -> tuple[set[str], int]:
        """Обрабатывает .maFile, копирует совпавшие и собирает логины."""
        target_logins: set[str] = set()
        copied_count = 0

        mafiles = list(source_dir.glob("*.maFile"))
        self.log(f"Найдено maFile: {len(mafiles)}")

        for mafile_path in mafiles:
            try:
                with mafile_path.open("r", encoding="utf-8", errors="ignore") as mf:
                    data = json.load(mf)
            except json.JSONDecodeError:
                self.log(f"Невалидный JSON, пропуск: {mafile_path.name}")
                continue
            except Exception as exc:
                self.log(f"Ошибка чтения файла {mafile_path.name}: {exc}")
                continue

            steam_id = self.extract_steam_id(data)
            account_name = data.get("account_name")

            if not steam_id:
                self.log(f"Нет SteamID в файле, пропуск: {mafile_path.name}")
                continue

            if not account_name:
                self.log(f"Нет account_name в файле, пропуск: {mafile_path.name}")
                continue

            if steam_id in steam_ids:
                try:
                    shutil.copy2(mafile_path, target_dir / mafile_path.name)
                    copied_count += 1
                    target_logins.add(str(account_name).strip())
                    self.log(f"Совпадение: {mafile_path.name} | SteamID={steam_id} | login={account_name}")
                except Exception as exc:
                    self.log(f"Ошибка копирования {mafile_path.name}: {exc}")

        return target_logins, copied_count

    @staticmethod
    def extract_steam_id(data: dict) -> str | None:
        """Извлекает SteamID из JSON по одному из поддерживаемых ключей."""
        # Вариант 1: верхнеуровневый ключ "steamid"
        top_level = data.get("steamid")
        if top_level:
            return str(top_level).strip()

        # Вариант 2: вложенный ключ Session -> SteamID
        session = data.get("Session")
        if isinstance(session, dict):
            nested = session.get("SteamID")
            if nested:
                return str(nested).strip()

        return None

    def filter_accounts_db(self, accounts_file: Path, target_logins: set[str], output_file: Path) -> int:
        """Фильтрует текстовую базу аккаунтов по списку целевых логинов."""
        written_count = 0

        with accounts_file.open("r", encoding="utf-8", errors="ignore") as source, output_file.open(
            "w", encoding="utf-8"
        ) as out:
            for line in source:
                raw = line.rstrip("\n")
                if not raw.strip():
                    continue

                # Берём логин как часть до первого двоеточия.
                login = raw.split(":", 1)[0].strip()
                if login and login in target_logins:
                    out.write(raw + "\n")
                    written_count += 1

        return written_count


def main() -> None:
    root = tk.Tk()
    app = SteamSorterApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
