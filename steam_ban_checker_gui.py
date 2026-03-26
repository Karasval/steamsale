import os
import re
import threading
import queue
from pathlib import Path
from typing import List, Dict

import requests
import tkinter as tk
from tkinter import filedialog, messagebox
from tkinter.scrolledtext import ScrolledText


API_URL = "http://api.steampowered.com/ISteamUser/GetPlayerBans/v1/"
STEAMID64_PATTERN = re.compile(r"\b\d{17}\b")
CHUNK_SIZE = 100


class SteamBanCheckerApp:
    """GUI-приложение для проверки SteamID на наличие банов через Steam Web API."""

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Steam Ban Checker")
        self.root.geometry("920x620")

        self.log_queue: queue.Queue[str] = queue.Queue()
        self.selected_folder: str = ""
        self.is_running = False

        self._build_ui()
        self._poll_log_queue()

    def _build_ui(self) -> None:
        """Создание элементов интерфейса."""
        main_frame = tk.Frame(self.root, padx=10, pady=10)
        main_frame.pack(fill="both", expand=True)

        # Поле API-ключа
        key_label = tk.Label(main_frame, text="Steam Web API Key:")
        key_label.grid(row=0, column=0, sticky="w")

        self.api_key_entry = tk.Entry(main_frame, width=70, show="*")
        self.api_key_entry.grid(row=0, column=1, padx=8, pady=5, sticky="we")

        # Выбор папки
        folder_btn = tk.Button(main_frame, text="Выбрать папку", command=self.select_folder)
        folder_btn.grid(row=1, column=0, padx=0, pady=5, sticky="w")

        self.folder_label = tk.Label(main_frame, text="Папка не выбрана", fg="gray")
        self.folder_label.grid(row=1, column=1, sticky="w")

        # Кнопка запуска
        self.start_btn = tk.Button(main_frame, text="Начать проверку", command=self.start_check)
        self.start_btn.grid(row=2, column=0, pady=8, sticky="w")

        # Логи
        log_label = tk.Label(main_frame, text="Логи проверки:")
        log_label.grid(row=3, column=0, columnspan=2, sticky="w", pady=(10, 2))

        self.log_text = ScrolledText(main_frame, width=110, height=30, state="disabled")
        self.log_text.grid(row=4, column=0, columnspan=2, sticky="nsew")

        main_frame.grid_columnconfigure(1, weight=1)
        main_frame.grid_rowconfigure(4, weight=1)

    def log(self, message: str) -> None:
        """Потокобезопасная запись сообщений в очередь логов."""
        self.log_queue.put(message)

    def _poll_log_queue(self) -> None:
        """Периодическая выгрузка сообщений из очереди в текстовое поле."""
        while not self.log_queue.empty():
            msg = self.log_queue.get_nowait()
            self.log_text.configure(state="normal")
            self.log_text.insert("end", msg + "\n")
            self.log_text.see("end")
            self.log_text.configure(state="disabled")
        self.root.after(100, self._poll_log_queue)

    def select_folder(self) -> None:
        """Открыть диалог выбора папки."""
        folder = filedialog.askdirectory(title="Выберите папку с .txt файлами")
        if folder:
            self.selected_folder = folder
            self.folder_label.config(text=folder, fg="black")
            self.log(f"Выбрана папка: {folder}")

    def start_check(self) -> None:
        """Проверка входных данных и запуск потока проверки."""
        if self.is_running:
            messagebox.showinfo("Информация", "Проверка уже выполняется.")
            return

        api_key = self.api_key_entry.get().strip()
        if not api_key:
            messagebox.showerror("Ошибка", "Введите Steam Web API Key.")
            return

        if not self.selected_folder:
            messagebox.showerror("Ошибка", "Сначала выберите папку с .txt файлами.")
            return

        self.is_running = True
        self.start_btn.config(state="disabled")
        worker = threading.Thread(target=self.run_check, args=(api_key, self.selected_folder), daemon=True)
        worker.start()

    @staticmethod
    def find_txt_files(folder: str) -> List[Path]:
        """Найти все .txt файлы в выбранной папке (включая подпапки)."""
        return [p for p in Path(folder).rglob("*.txt") if p.is_file()]

    @staticmethod
    def extract_steamids_from_files(files: List[Path]) -> List[str]:
        """Извлечь уникальные SteamID64 (17 цифр) из списка файлов."""
        seen = set()
        result = []

        for file_path in files:
            try:
                text = file_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            for match in STEAMID64_PATTERN.findall(text):
                if match not in seen:
                    seen.add(match)
                    result.append(match)

        return result

    @staticmethod
    def chunk_list(items: List[str], size: int) -> List[List[str]]:
        """Разбить список на чанки фиксированного размера."""
        return [items[i:i + size] for i in range(0, len(items), size)]

    def fetch_bans(self, api_key: str, steamids: List[str]) -> List[Dict]:
        """Запросить информацию о банах для группы SteamID."""
        params = {
            "key": api_key,
            "steamids": ",".join(steamids),
        }

        response = requests.get(API_URL, params=params, timeout=20)

        # Обрабатываем самые частые ошибки API/сети
        if response.status_code == 403:
            raise ValueError("Steam API вернул 403 (доступ запрещён). Проверьте корректность API ключа.")
        if response.status_code != 200:
            raise RuntimeError(f"Steam API вернул код: {response.status_code}")

        data = response.json()
        players = data.get("players")
        if players is None:
            raise RuntimeError("Неожиданный формат ответа Steam API.")

        return players

    def run_check(self, api_key: str, folder: str) -> None:
        """Основная логика проверки (выполняется в отдельном потоке)."""
        try:
            self.log("Поиск .txt файлов...")
            txt_files = self.find_txt_files(folder)
            self.log(f"Найдено .txt файлов: {len(txt_files)}")

            if not txt_files:
                self.log("Ошибка: В выбранной папке нет .txt файлов.")
                messagebox.showerror("Ошибка", "В выбранной папке нет .txt файлов.")
                return

            steamids = self.extract_steamids_from_files(txt_files)
            self.log(f"Извлечено уникальных SteamID64: {len(steamids)}")

            if not steamids:
                self.log("Ошибка: SteamID64 (17 цифр) не найдены в файлах.")
                messagebox.showerror("Ошибка", "SteamID64 (17 цифр) не найдены в файлах.")
                return

            chunks = self.chunk_list(steamids, CHUNK_SIZE)
            self.log(f"Начинаю проверку. Количество запросов (чанков по {CHUNK_SIZE}): {len(chunks)}")

            banned_ids = []
            clean_ids = []

            processed = 0
            for index, chunk in enumerate(chunks, start=1):
                self.log(f"Запрос {index}/{len(chunks)}: проверка {len(chunk)} SteamID...")
                players = self.fetch_bans(api_key, chunk)

                players_by_id = {p.get("SteamId", ""): p for p in players}

                for sid in chunk:
                    p = players_by_id.get(sid)
                    if not p:
                        self.log(f"SteamID {sid}: не получен в ответе API.")
                        continue

                    vac_banned = bool(p.get("VACBanned", False))
                    community_banned = bool(p.get("CommunityBanned", False))
                    game_bans = int(p.get("NumberOfGameBans", 0))

                    has_ban = vac_banned or community_banned or (game_bans > 0)
                    if has_ban:
                        banned_ids.append(sid)
                    else:
                        clean_ids.append(sid)

                    self.log(
                        f"SteamID {sid}: "
                        f"VAC Ban - {'Да' if vac_banned else 'Нет'}, "
                        f"Community Ban - {'Да' if community_banned else 'Нет'}, "
                        f"Game Ban - {'Да' if game_bans > 0 else 'Нет'}"
                    )

                    processed += 1

            banned_path = os.path.join(folder, "results_banned.txt")
            clean_path = os.path.join(folder, "results_clean.txt")

            Path(banned_path).write_text("\n".join(banned_ids), encoding="utf-8")
            Path(clean_path).write_text("\n".join(clean_ids), encoding="utf-8")

            self.log("")
            self.log("Проверка завершена успешно.")
            self.log(f"Обработано SteamID: {processed}")
            self.log(f"С банами: {len(banned_ids)}")
            self.log(f"Чистые: {len(clean_ids)}")
            self.log(f"Сохранено: {banned_path}")
            self.log(f"Сохранено: {clean_path}")
            messagebox.showinfo("Готово", "Проверка завершена. Результаты сохранены в выбранной папке.")

        except requests.exceptions.RequestException as e:
            self.log(f"Сетевая ошибка: {e}")
            messagebox.showerror("Сетевая ошибка", f"Не удалось выполнить запрос к Steam API.\n\n{e}")

        except ValueError as e:
            self.log(f"Ошибка API ключа/доступа: {e}")
            messagebox.showerror("Ошибка API", str(e))

        except Exception as e:
            self.log(f"Непредвиденная ошибка: {e}")
            messagebox.showerror("Ошибка", f"Произошла непредвиденная ошибка:\n\n{e}")

        finally:
            self.is_running = False
            self.start_btn.config(state="normal")


def main() -> None:
    root = tk.Tk()
    app = SteamBanCheckerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
