import json
import queue
import random
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Set, Tuple

import requests
import tkinter as tk
from tkinter import scrolledtext


class MarketMonitorApp:
    MARKET_RENDER_URL = (
        "https://steamcommunity.com/market/listings/730/"
        "Charm%20%7C%20Die-cast%20AK/render/"
    )
    TEMPLATE_PATTERN = re.compile(r"Charm Template:\s*(\d+)")

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Steam Market Monitor")
        self.root.geometry("780x520")

        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.monitor_thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        self.seen_listing_ids: Set[str] = set()

        self.file_path = Path("found_items.txt")
        self.file_logged_ids: Set[str] = set()
        self._load_file_ids()

        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0"})

        self._build_gui()
        self._schedule_log_flush()

    def _build_gui(self) -> None:
        controls = tk.Frame(self.root)
        controls.pack(fill=tk.X, padx=10, pady=10)

        tk.Label(controls, text="Listings to parse:").grid(row=0, column=0, sticky="w")
        self.count_var = tk.StringVar(value="100")
        tk.Entry(controls, textvariable=self.count_var, width=12).grid(
            row=0, column=1, padx=(5, 15), sticky="w"
        )

        tk.Label(controls, text="Proxy (optional):").grid(row=0, column=2, sticky="w")
        self.proxy_var = tk.StringVar(value="")
        tk.Entry(controls, textvariable=self.proxy_var, width=40).grid(
            row=0, column=3, padx=5, sticky="we"
        )

        controls.grid_columnconfigure(3, weight=1)

        buttons = tk.Frame(self.root)
        buttons.pack(fill=tk.X, padx=10)

        self.start_btn = tk.Button(buttons, text="Start", width=12, command=self.start_monitoring)
        self.start_btn.pack(side=tk.LEFT, padx=(0, 8), pady=5)

        self.stop_btn = tk.Button(buttons, text="Stop", width=12, state=tk.DISABLED, command=self.stop_monitoring)
        self.stop_btn.pack(side=tk.LEFT, pady=5)

        self.status_var = tk.StringVar(value="Stopped")
        tk.Label(buttons, text="Status:").pack(side=tk.LEFT, padx=(20, 4))
        tk.Label(buttons, textvariable=self.status_var, fg="blue").pack(side=tk.LEFT)

        self.log_text = scrolledtext.ScrolledText(self.root, wrap=tk.WORD, state=tk.DISABLED)
        self.log_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(8, 10))

    def _load_file_ids(self) -> None:
        if not self.file_path.exists():
            return
        pattern = re.compile(r"ID:\s*(\d+)")
        try:
            for line in self.file_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                match = pattern.search(line)
                if match:
                    self.file_logged_ids.add(match.group(1))
        except OSError:
            pass

    def _schedule_log_flush(self) -> None:
        self._flush_logs()
        self.root.after(150, self._schedule_log_flush)

    def _flush_logs(self) -> None:
        while True:
            try:
                message = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self.log_text.configure(state=tk.NORMAL)
            self.log_text.insert(tk.END, message + "\n")
            self.log_text.see(tk.END)
            self.log_text.configure(state=tk.DISABLED)

    def log(self, message: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        full = f"[{timestamp}] {message}"
        print(full)
        self.log_queue.put(full)

    def fetch_page(self, start: int, count: int, proxies: Optional[Dict[str, str]]) -> Optional[dict]:
        params = {"start": start, "count": count, "currency": 1}
        try:
            response = self.session.get(
                self.MARKET_RENDER_URL,
                params=params,
                timeout=10,
                proxies=proxies,
            )
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, json.JSONDecodeError) as exc:
            self.log(f"Request error (start={start}): {exc}")
            return None

    def parse_listing(self, listing: dict, assets: dict) -> Optional[Tuple[str, int, float]]:
        listing_id = str(listing.get("listingid") or listing.get("listing_id") or "")
        if not listing_id:
            return None

        asset = listing.get("asset") or {}
        appid = str(asset.get("appid", "730"))
        contextid = str(asset.get("contextid", "2"))
        asset_id = str(asset.get("id", ""))
        if not asset_id:
            return None

        asset_description = (
            assets.get(appid, {})
            .get(contextid, {})
            .get(asset_id, {})
        )

        descriptions = asset_description.get("descriptions")
        if not isinstance(descriptions, list):
            return None

        template_value = None
        for entry in descriptions:
            value = entry.get("value", "") if isinstance(entry, dict) else ""
            match = self.TEMPLATE_PATTERN.search(value)
            if match:
                template_value = int(match.group(1))
                break

        if template_value is None:
            return None

        in_range = (1 <= template_value <= 5000) or (20000 <= template_value <= 25000)
        if not in_range:
            return None

        price_cents = listing.get("converted_price")
        if price_cents is None:
            price_cents = listing.get("price")
        if price_cents is None:
            return None

        price = float(price_cents) / 100.0
        return listing_id, template_value, price

    def process_cycle(self, listings_to_parse: int, proxy: str) -> None:
        proxies = None
        if proxy.strip():
            proxies = {"http": proxy.strip(), "https": proxy.strip()}

        if listings_to_parse <= 0:
            self.log("Invalid listing count. Must be > 0.")
            return

        starts = range(0, listings_to_parse, 10)
        found_this_cycle = 0

        for start in starts:
            if self.stop_event.is_set():
                break

            payload = self.fetch_page(start=start, count=10, proxies=proxies)
            if not payload:
                time.sleep(random.uniform(0.2, 0.5))
                continue

            listinginfo = payload.get("listinginfo") or {}
            assets = payload.get("assets") or {}
            if not listinginfo:
                self.log(f"Empty listing page at start={start}.")
                time.sleep(random.uniform(0.2, 0.5))
                continue

            for _, listing in listinginfo.items():
                if self.stop_event.is_set():
                    break

                listing_id = str(listing.get("listingid") or listing.get("listing_id") or "")
                if not listing_id or listing_id in self.seen_listing_ids:
                    continue

                self.seen_listing_ids.add(listing_id)
                parsed = self.parse_listing(listing, assets)
                if not parsed:
                    continue

                p_id, template_value, price = parsed
                found_this_cycle += 1
                msg = f"ID: {p_id} | Template: {template_value} | Price: {price:.2f}"
                self.log(msg)
                self._append_to_file_if_new(p_id, template_value, price)

            time.sleep(random.uniform(0.2, 0.5))

        self.log(f"Cycle complete. Matches found: {found_this_cycle}")

    def _append_to_file_if_new(self, listing_id: str, template: int, price: float) -> None:
        if listing_id in self.file_logged_ids:
            return
        timestamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{timestamp}] ID: {listing_id} | Template: {template} | Price: {price:.2f}\n"
        try:
            with self.file_path.open("a", encoding="utf-8") as f:
                f.write(line)
            self.file_logged_ids.add(listing_id)
        except OSError as exc:
            self.log(f"File write error: {exc}")

    def _monitor_loop(self, listings_to_parse: int, proxy: str) -> None:
        self.log("Monitoring started.")
        while not self.stop_event.is_set():
            self.process_cycle(listings_to_parse=listings_to_parse, proxy=proxy)
            for _ in range(50):
                if self.stop_event.is_set():
                    break
                time.sleep(0.1)
        self.log("Monitoring stopped.")
        self.root.after(0, self._set_stopped_state)

    def start_monitoring(self) -> None:
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.log("Monitor already running.")
            return

        try:
            listings_to_parse = int(self.count_var.get().strip())
        except ValueError:
            self.log("Invalid listing count. Please enter an integer.")
            return

        proxy = self.proxy_var.get().strip()

        self.stop_event.clear()
        self.status_var.set("Running")
        self.start_btn.configure(state=tk.DISABLED)
        self.stop_btn.configure(state=tk.NORMAL)

        self.monitor_thread = threading.Thread(
            target=self._monitor_loop,
            args=(listings_to_parse, proxy),
            daemon=True,
        )
        self.monitor_thread.start()

    def _set_stopped_state(self) -> None:
        self.status_var.set("Stopped")
        self.start_btn.configure(state=tk.NORMAL)
        self.stop_btn.configure(state=tk.DISABLED)

    def stop_monitoring(self) -> None:
        self.stop_event.set()
        self._set_stopped_state()


def main() -> None:
    root = tk.Tk()
    app = MarketMonitorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
