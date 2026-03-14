#!/usr/bin/env python3
"""GUI-утилита для автопродажи предмета на Steam Community Market.

Важно:
- Используйте только на своих аккаунтах.
- Учитывайте риски блокировок и ограничения Steam.
"""

from __future__ import annotations

import json
import queue
import re
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from urllib.parse import quote_plus

import requests

try:
    from steampy.client import SteamClient
    from steampy.confirmation import ConfirmationExecutor
    from steampy.utils import GameOptions
except ImportError as exc:  # pragma: no cover - обработка отсутствующей зависимости
    raise SystemExit(
        "Не установлен steampy. Установите зависимости: pip install steampy requests"
    ) from exc


RUB_CURRENCY_CODE = 5


class SteamAutoSeller:
    def __init__(self, log_func):
        self.log = log_func

    @staticmethod
    def read_credentials(credentials_file: Path) -> tuple[str, str]:
        lines = [line.strip() for line in credentials_file.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not lines:
            raise ValueError("Файл с логином/паролем пуст.")

        first = lines[0]
        if ":" in first:
            username, password = first.split(":", 1)
        elif ";" in first:
            username, password = first.split(";", 1)
        else:
            raise ValueError("Формат файла должен быть login:password или login;password в первой строке.")

        if not username or not password:
            raise ValueError("Логин или пароль пустые.")
        return username.strip(), password.strip()

    @staticmethod
    def find_mafile(mafiles_dir: Path, username: str) -> Path:
        direct = mafiles_dir / f"{username}.maFile"
        if direct.exists():
            return direct

        matches = list(mafiles_dir.glob("*.maFile"))
        if len(matches) == 1:
            return matches[0]

        raise FileNotFoundError(
            f"Не найден maFile для пользователя {username}. Ожидается {username}.maFile"
        )

    @staticmethod
    def parse_price_to_rub(price_str: str) -> float:
        cleaned = re.sub(r"[^0-9,\.]", "", price_str).replace(",", ".")
        if cleaned.count(".") > 1:
            first_dot = cleaned.find(".")
            cleaned = cleaned[: first_dot + 1] + cleaned[first_dot + 1 :].replace(".", "")
        return float(cleaned)

    def fetch_lowest_price(self, appid: int, market_hash_name: str, proxies: dict | None) -> float:
        url = (
            "https://steamcommunity.com/market/priceoverview/"
            f"?appid={appid}&currency={RUB_CURRENCY_CODE}&market_hash_name={quote_plus(market_hash_name)}"
        )
        response = requests.get(url, timeout=20, proxies=proxies)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("success") or "lowest_price" not in payload:
            raise RuntimeError(f"Не удалось получить цену: {payload}")
        return self.parse_price_to_rub(payload["lowest_price"])

    @staticmethod
    def to_cents(amount_rub: float) -> int:
        cents = int(round(amount_rub * 100))
        if cents < 3:
            raise ValueError("Цена после вычета должна быть не меньше 0.03 руб.")
        return cents

    def _set_proxy(self, steam_client: SteamClient, proxy_url: str | None):
        if not proxy_url:
            return None
        proxies = {"http": proxy_url, "https": proxy_url}
        steam_client._session.proxies.update(proxies)
        return proxies

    def _load_identity_secret(self, mafile_path: Path) -> str:
        data = json.loads(mafile_path.read_text(encoding="utf-8"))
        identity_secret = data.get("identity_secret")
        if not identity_secret:
            raise RuntimeError("В maFile отсутствует identity_secret для подтверждения продаж.")
        return identity_secret

    def _find_inventory_item(self, inventory: dict, item_name: str):
        for asset_id, item in inventory.items():
            if item.get("market_hash_name") == item_name:
                return asset_id, item
        raise RuntimeError(f"Предмет '{item_name}' не найден в инвентаре.")

    def sell_item_flow(
        self,
        credentials_file: Path,
        mafiles_dir: Path,
        appid: int,
        contextid: str,
        item_name: str,
        proxy_url: str | None,
        undercut_rub: float,
    ):
        username, password = self.read_credentials(credentials_file)
        self.log(f"[+] Используем аккаунт: {username}")

        mafile_path = self.find_mafile(mafiles_dir, username)
        self.log(f"[+] Найден maFile: {mafile_path.name}")

        steam_client = SteamClient(api_key=None)
        proxies = self._set_proxy(steam_client, proxy_url)
        if proxies:
            self.log(f"[+] Прокси включён: {proxy_url}")

        self.log("[+] Авторизация в Steam...")
        steam_client.login(username, password, str(mafile_path))
        self.log("[+] Успешный вход.")

        game = GameOptions(str(appid), str(contextid))
        inventory = steam_client.get_my_inventory(game=game)
        asset_id, item = self._find_inventory_item(inventory, item_name)
        self.log(f"[+] Найден предмет: {item.get('market_hash_name')} (asset_id={asset_id})")

        lowest_price = self.fetch_lowest_price(appid, item_name, proxies)
        target_price = max(lowest_price - undercut_rub, 0.03)
        price_cents = self.to_cents(target_price)
        self.log(f"[+] Минимальная цена: {lowest_price:.2f} RUB. Выставляем: {target_price:.2f} RUB")

        self.log("[+] Создаём ордер на продажу...")
        steam_client.market.create_sell_order(asset_id=asset_id, game=game, price=price_cents)

        self.log("[+] Подтверждаем выставление через мобильные подтверждения...")
        identity_secret = self._load_identity_secret(mafile_path)
        confirmer = ConfirmationExecutor(identity_secret, steam_client)

        # Подтверждаем с небольшими ретраями, т.к. ордер может появиться не мгновенно
        last_error = None
        for _ in range(6):
            try:
                confirmer.confirm_sell_listing(asset_id)
                self.log("[+] Продажа подтверждена.")
                break
            except Exception as exc:  # pragma: no cover - внешняя API-ошибка
                last_error = exc
                time.sleep(2)
        else:
            raise RuntimeError(f"Не удалось подтвердить продажу: {last_error}")

        steam_client.logout()
        self.log("[+] Готово: предмет выставлен и подтверждён.")


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Steam Auto Seller")
        self.geometry("760x520")

        self.log_queue: queue.Queue[str] = queue.Queue()
        self.worker: threading.Thread | None = None

        self.credentials_var = tk.StringVar()
        self.mafiles_var = tk.StringVar()
        self.appid_var = tk.StringVar(value="730")
        self.contextid_var = tk.StringVar(value="2")
        self.item_var = tk.StringVar()
        self.proxy_var = tk.StringVar()
        self.undercut_var = tk.StringVar(value="0.01")

        self._build_ui()
        self.after(150, self._flush_logs)

    def _build_ui(self):
        frm = ttk.Frame(self, padding=12)
        frm.pack(fill="both", expand=True)

        def add_row(label_text, var, row, browse_cmd=None):
            ttk.Label(frm, text=label_text).grid(row=row, column=0, sticky="w", pady=4)
            entry = ttk.Entry(frm, textvariable=var, width=72)
            entry.grid(row=row, column=1, sticky="ew", pady=4)
            if browse_cmd:
                ttk.Button(frm, text="...", width=4, command=browse_cmd).grid(row=row, column=2, padx=4)

        add_row("Файл login:password", self.credentials_var, 0, self._pick_credentials)
        add_row("Папка maFiles", self.mafiles_var, 1, self._pick_mafiles)
        add_row("AppID", self.appid_var, 2)
        add_row("ContextID", self.contextid_var, 3)
        add_row("Название предмета (market_hash_name)", self.item_var, 4)
        add_row("Прокси (опционально, например http://user:pass@host:port)", self.proxy_var, 5)
        add_row("Снижение цены, RUB (например 0.01)", self.undercut_var, 6)

        frm.columnconfigure(1, weight=1)

        self.run_btn = ttk.Button(frm, text="Авторизоваться и продать", command=self._run)
        self.run_btn.grid(row=7, column=0, columnspan=3, pady=10, sticky="ew")

        self.log_box = tk.Text(frm, height=16, state="disabled")
        self.log_box.grid(row=8, column=0, columnspan=3, sticky="nsew", pady=(8, 0))
        frm.rowconfigure(8, weight=1)

    def _pick_credentials(self):
        path = filedialog.askopenfilename(filetypes=[("Text files", "*.txt"), ("All files", "*")])
        if path:
            self.credentials_var.set(path)

    def _pick_mafiles(self):
        path = filedialog.askdirectory()
        if path:
            self.mafiles_var.set(path)

    def _log(self, text: str):
        self.log_queue.put(text)

    def _flush_logs(self):
        while not self.log_queue.empty():
            message = self.log_queue.get_nowait()
            self.log_box.configure(state="normal")
            self.log_box.insert("end", f"{message}\n")
            self.log_box.see("end")
            self.log_box.configure(state="disabled")
        self.after(150, self._flush_logs)

    def _run(self):
        if self.worker and self.worker.is_alive():
            messagebox.showwarning("Выполняется", "Операция уже выполняется.")
            return

        try:
            credentials_file = Path(self.credentials_var.get().strip())
            mafiles_dir = Path(self.mafiles_var.get().strip())
            appid = int(self.appid_var.get().strip())
            contextid = self.contextid_var.get().strip()
            item_name = self.item_var.get().strip()
            proxy_url = self.proxy_var.get().strip() or None
            undercut = float(self.undercut_var.get().strip())

            if not credentials_file.exists():
                raise ValueError("Файл логина/пароля не найден.")
            if not mafiles_dir.exists():
                raise ValueError("Папка maFiles не найдена.")
            if not item_name:
                raise ValueError("Укажите название предмета.")
            if undercut < 0:
                raise ValueError("Снижение цены не может быть отрицательным.")
        except Exception as exc:
            messagebox.showerror("Ошибка ввода", str(exc))
            return

        self.run_btn.configure(state="disabled")
        self._log("[i] Старт операции...")

        def worker_func():
            seller = SteamAutoSeller(self._log)
            try:
                seller.sell_item_flow(
                    credentials_file=credentials_file,
                    mafiles_dir=mafiles_dir,
                    appid=appid,
                    contextid=contextid,
                    item_name=item_name,
                    proxy_url=proxy_url,
                    undercut_rub=undercut,
                )
                self._log("[✓] Успешно завершено.")
            except Exception as exc:  # pragma: no cover - runtime ошибки внешних API
                self._log(f"[x] Ошибка: {exc}")
            finally:
                self.after(0, lambda: self.run_btn.configure(state="normal"))

        self.worker = threading.Thread(target=worker_func, daemon=True)
        self.worker.start()


if __name__ == "__main__":
    app = App()
    app.mainloop()
