import json
import queue
import random
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import cycle
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText

BAN_KEYWORDS = [
    "banned",
    "vac ban",
    "community ban",
    "game ban",
    "trade ban",
]


class SteamValidatorApp:
    """GUI-приложение для отбора валидных Steam-аккаунтов по .maFile."""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Steam .maFile Validator")
        self.root.geometry("900x650")

        self.mafolder_var = tk.StringVar()
        self.accounts_var = tk.StringVar()
        self.proxy_var = tk.StringVar()
        self.threads_var = tk.StringVar(value="10")

        self.stop_event = threading.Event()
        self.worker_thread: Optional[threading.Thread] = None

        self.log_queue: queue.Queue[str] = queue.Queue()

        self._build_ui()
        self._poll_log_queue()

    def _build_ui(self) -> None:
        pad = {"padx": 8, "pady": 6}

        frm = ttk.Frame(self.root)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Папка с .maFile:").grid(row=0, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.mafolder_var, width=75).grid(row=0, column=1, **pad)
        ttk.Button(frm, text="Выбрать", command=self._select_ma_folder).grid(row=0, column=2, **pad)

        ttk.Label(frm, text="Файл login:password:").grid(row=1, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.accounts_var, width=75).grid(row=1, column=1, **pad)
        ttk.Button(frm, text="Выбрать", command=self._select_accounts_file).grid(row=1, column=2, **pad)

        ttk.Label(frm, text="Файл прокси (опц.):").grid(row=2, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.proxy_var, width=75).grid(row=2, column=1, **pad)
        ttk.Button(frm, text="Выбрать", command=self._select_proxy_file).grid(row=2, column=2, **pad)

        ttk.Label(frm, text="Потоков:").grid(row=3, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.threads_var, width=10).grid(row=3, column=1, sticky="w", **pad)

        button_frame = ttk.Frame(frm)
        button_frame.grid(row=4, column=1, sticky="w", **pad)
        self.start_btn = ttk.Button(button_frame, text="Запустить", command=self.start)
        self.start_btn.pack(side="left", padx=(0, 8))
        self.stop_btn = ttk.Button(button_frame, text="Стоп", command=self.stop, state="disabled")
        self.stop_btn.pack(side="left")

        self.progress = ttk.Progressbar(frm, orient="horizontal", mode="determinate", length=700)
        self.progress.grid(row=5, column=0, columnspan=3, sticky="ew", **pad)

        ttk.Label(frm, text="Логи:").grid(row=6, column=0, sticky="nw", **pad)
        self.log_box = ScrolledText(frm, width=110, height=26, state="disabled")
        self.log_box.grid(row=6, column=1, columnspan=2, sticky="nsew", **pad)

        frm.columnconfigure(1, weight=1)
        frm.rowconfigure(6, weight=1)

    def _select_ma_folder(self) -> None:
        path = filedialog.askdirectory(title="Выберите папку с .maFile")
        if path:
            self.mafolder_var.set(path)

    def _select_accounts_file(self) -> None:
        path = filedialog.askopenfilename(title="Выберите файл аккаунтов", filetypes=[("Text", "*.txt"), ("All", "*.*")])
        if path:
            self.accounts_var.set(path)

    def _select_proxy_file(self) -> None:
        path = filedialog.askopenfilename(title="Выберите файл прокси", filetypes=[("Text", "*.txt"), ("All", "*.*")])
        if path:
            self.proxy_var.set(path)

    def log(self, message: str) -> None:
        self.log_queue.put(message)

    def _poll_log_queue(self) -> None:
        while True:
            try:
                msg = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self.log_box.configure(state="normal")
            self.log_box.insert("end", msg + "\n")
            self.log_box.see("end")
            self.log_box.configure(state="disabled")
        self.root.after(100, self._poll_log_queue)

    def start(self) -> None:
        if self.worker_thread and self.worker_thread.is_alive():
            messagebox.showwarning("Уже запущено", "Обработка уже выполняется.")
            return

        ma_folder = Path(self.mafolder_var.get().strip())
        accounts_file = Path(self.accounts_var.get().strip())
        proxy_file_raw = self.proxy_var.get().strip()
        proxy_file = Path(proxy_file_raw) if proxy_file_raw else None

        if not ma_folder.is_dir():
            messagebox.showerror("Ошибка", "Укажите корректную папку с .maFile")
            return
        if not accounts_file.is_file():
            messagebox.showerror("Ошибка", "Укажите корректный файл login:password")
            return
        if proxy_file and not proxy_file.is_file():
            messagebox.showerror("Ошибка", "Файл прокси не найден")
            return

        try:
            threads = int(self.threads_var.get())
            if threads <= 0:
                raise ValueError
        except ValueError:
            messagebox.showerror("Ошибка", "Количество потоков должно быть положительным числом")
            return

        self.stop_event.clear()
        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")

        self.worker_thread = threading.Thread(
            target=self._run_validation,
            args=(ma_folder, accounts_file, proxy_file, threads),
            daemon=True,
        )
        self.worker_thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.log("[INFO] Остановка запрошена пользователем...")

    def _run_validation(self, ma_folder: Path, accounts_file: Path, proxy_file: Optional[Path], threads: int) -> None:
        try:
            accounts_map = self._load_accounts(accounts_file)
            proxies = self._load_proxies(proxy_file) if proxy_file else []

            mafiles = sorted(ma_folder.glob("*.maFile"))
            total = len(mafiles)
            if total == 0:
                self.log("[WARN] В указанной папке нет .maFile")
                return

            self.progress.configure(maximum=total, value=0)
            valid_pairs: List[Tuple[str, str, Path]] = []
            invalid_logins: List[str] = []

            self.log(f"[INFO] Найдено .maFile: {total}")
            self.log(f"[INFO] Потоков: {threads}")
            self.log(f"[INFO] Прокси загружено: {len(proxies)}")

            proxy_cycle = cycle(proxies) if proxies else None

            with ThreadPoolExecutor(max_workers=threads) as executor:
                futures = []
                for ma_file in mafiles:
                    if self.stop_event.is_set():
                        break
                    futures.append(executor.submit(self._process_mafile, ma_file, accounts_map, proxy_cycle))

                done_count = 0
                for fut in as_completed(futures):
                    if self.stop_event.is_set():
                        break
                    result = fut.result()
                    done_count += 1
                    self.root.after(0, lambda v=done_count: self.progress.configure(value=v))

                    if result:
                        login, password, ma_path, is_valid, add_to_invalid = result
                        if is_valid:
                            valid_pairs.append((login, password, ma_path))
                        elif add_to_invalid:
                            invalid_logins.append(login)
                    else:
                        continue

            if self.stop_event.is_set():
                self.log("[INFO] Выполнение остановлено до завершения.")
                return

            valid_pairs.sort(key=lambda x: x[0].lower())
            self._save_results(ma_folder, valid_pairs, invalid_logins)
            self.log(f"[DONE] Готово. Валидных аккаунтов: {len(valid_pairs)}")

        except Exception as exc:
            self.log(f"[ERROR] Критическая ошибка: {exc}")
        finally:
            self.root.after(0, self._on_finish)

    def _on_finish(self) -> None:
        self.start_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")

    def _load_accounts(self, path: Path) -> Dict[str, Tuple[str, str]]:
        result: Dict[str, Tuple[str, str]] = {}
        for line_no, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
            line = line.strip()
            if not line or ":" not in line:
                continue
            login, password = line.split(":", 1)
            login = login.strip()
            password = password.strip()
            if login:
                result[login] = (login, password)
            else:
                self.log(f"[WARN] Пустой login в строке {line_no}")
        return result

    def _load_proxies(self, path: Optional[Path]) -> List[str]:
        if not path:
            return []
        proxies: List[str] = []
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line:
                proxies.append(line)
        return proxies

    def _extract_steamid(self, ma_file: Path) -> Optional[str]:
        try:
            data = json.loads(ma_file.read_text(encoding="utf-8", errors="ignore"))
        except Exception as exc:
            self.log(f"[WARN] Битый JSON: {ma_file.name}: {exc}")
            return None

        candidates = [
            data.get("Session", {}).get("SteamID") if isinstance(data.get("Session"), dict) else None,
            data.get("steamid"),
            data.get("SteamID"),
        ]

        for candidate in candidates:
            if candidate:
                return str(candidate)

        self.log(f"[WARN] Не найден steamid в {ma_file.name}")
        return None

    def _build_proxy_dict(self, proxy_raw: Optional[str]) -> Optional[Dict[str, str]]:
        if not proxy_raw:
            return None
        proxy_url = proxy_raw
        if not proxy_url.startswith(("http://", "https://", "socks5://")):
            proxy_url = f"http://{proxy_url}"
        return {"http": proxy_url, "https": proxy_url}

    def _profile_has_ban(self, html_text: str) -> bool:
        soup = BeautifulSoup(html_text, "html.parser")
        page_text = soup.get_text(" ", strip=True).lower()
        return any(keyword in page_text for keyword in BAN_KEYWORDS)

    def _process_mafile(
        self, ma_file: Path, accounts_map: Dict[str, Tuple[str, str]], proxy_cycle
    ) -> Optional[Tuple[str, str, Path, bool, bool]]:
        if self.stop_event.is_set():
            return None

        login = ma_file.stem
        account = accounts_map.get(login)
        if not account:
            self.log(f"[WARN] Нет пары login:password для {ma_file.name}")
            return login, "", ma_file, False, True

        steamid = self._extract_steamid(ma_file)
        if not steamid:
            return login, account[1], ma_file, False, True

        url = f"https://steamcommunity.com/profiles/{steamid}"
        attempts = 3  # первая попытка + 2 повторные на других прокси
        for attempt in range(1, attempts + 1):
            if self.stop_event.is_set():
                return None

            proxy_raw = next(proxy_cycle) if proxy_cycle else None
            proxies = self._build_proxy_dict(proxy_raw)
            time.sleep(random.uniform(0.5, 2.0))

            try:
                response = requests.get(
                    url,
                    headers={"User-Agent": "Mozilla/5.0"},
                    timeout=12,
                    proxies=proxies,
                    allow_redirects=True,
                )

                # Если профиль недоступен/приватен и нет явных признаков бана, считаем валидным.
                if response.status_code >= 500:
                    self.log(f"[WARN] {login}: серверная ошибка Steam {response.status_code}, пропуск")
                    return login, account[1], ma_file, False, True

                if self._profile_has_ban(response.text):
                    self.log(f"[BAN] {login}: обнаружены признаки блокировки")
                    return login, account[1], ma_file, False, False

                self.log(f"[OK] {login}: валидный")
                return account[0], account[1], ma_file, True, False

            except requests.exceptions.ProxyError as exc:
                self.log(f"[WARN] {login}: ошибка прокси {proxy_raw}: {exc} (попытка {attempt}/{attempts})")
            except requests.exceptions.Timeout:
                self.log(f"[WARN] {login}: таймаут запроса (попытка {attempt}/{attempts})")
            except requests.RequestException as exc:
                self.log(f"[WARN] {login}: ошибка сети {exc} (попытка {attempt}/{attempts})")

            if not proxy_cycle:
                break
        return login, account[1], ma_file, False, True

    def _save_results(
        self, ma_folder: Path, valid_pairs: List[Tuple[str, str, Path]], invalid_logins: List[str]
    ) -> None:
        output_dir = ma_folder / "valid_accounts"
        output_dir.mkdir(parents=True, exist_ok=True)

        valid_lines: List[str] = []
        for login, password, ma_path in valid_pairs:
            valid_lines.append(f"{login}:{password}")
            dst = output_dir / ma_path.name
            try:
                shutil.copy2(ma_path, dst)
            except Exception as exc:
                self.log(f"[WARN] Не удалось скопировать {ma_path.name}: {exc}")

        (output_dir / "valid.txt").write_text("\n".join(valid_lines), encoding="utf-8")
        sorted_invalid = sorted(set(invalid_logins), key=str.lower)
        (output_dir / "invalid.txt").write_text("\n".join(sorted_invalid), encoding="utf-8")
        self.log(f"[INFO] Результаты сохранены: {output_dir}")


def main() -> None:
    root = tk.Tk()
    app = SteamValidatorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
