#!/usr/bin/env python3
"""GUI utility to extract SteamID values from Steam maFiles."""

from __future__ import annotations

import json
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


STEAM_ID_KEYS = {"steamid", "steam_id", "steamid64", "steamid3"}


def find_steam_ids(payload: object) -> set[str]:
    """Recursively search JSON payload for values that look like Steam IDs."""
    found: set[str] = set()

    if isinstance(payload, dict):
        for key, value in payload.items():
            normalized_key = key.lower().replace(" ", "")
            if normalized_key in STEAM_ID_KEYS and isinstance(value, (str, int)):
                candidate = str(value).strip()
                if candidate:
                    found.add(candidate)
            found.update(find_steam_ids(value))
    elif isinstance(payload, list):
        for item in payload:
            found.update(find_steam_ids(item))

    return found


def extract_from_mafiles(folder: Path) -> dict[str, set[str]]:
    """Parse all JSON-like files in folder and return Steam IDs by filename."""
    result: dict[str, set[str]] = {}

    for path in sorted(folder.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".mafile", ".json"}:
            continue

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        steam_ids = find_steam_ids(payload)
        if steam_ids:
            result[path.name] = steam_ids

    return result


def write_steam_ids_to_file(folder: Path, steam_ids: set[str]) -> Path:
    """Write unique Steam IDs to a txt file in selected folder."""
    output_path = folder / "steam_ids.txt"
    output_path.write_text("\n".join(sorted(steam_ids)) + "\n", encoding="utf-8")
    return output_path


class SteamIdExtractorApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("SteamID из maFiles")
        self.root.geometry("760x460")

        self.folder_var = tk.StringVar()

        container = ttk.Frame(root, padding=12)
        container.pack(fill="both", expand=True)

        ttk.Label(
            container,
            text="Выберите папку с Steam maFiles (.maFile / .json):",
        ).pack(anchor="w")

        controls = ttk.Frame(container)
        controls.pack(fill="x", pady=8)

        ttk.Entry(controls, textvariable=self.folder_var).pack(
            side="left",
            fill="x",
            expand=True,
            padx=(0, 8),
        )

        ttk.Button(controls, text="Обзор", command=self.pick_folder).pack(side="left")
        ttk.Button(
            controls,
            text="Вытянуть SteamID",
            command=self.process_folder,
        ).pack(side="left", padx=(8, 0))

        self.output = tk.Text(container, wrap="word", height=20)
        self.output.pack(fill="both", expand=True)

    def pick_folder(self) -> None:
        chosen = filedialog.askdirectory(title="Выберите папку с maFiles")
        if chosen:
            self.folder_var.set(chosen)

    def process_folder(self) -> None:
        self.output.delete("1.0", tk.END)
        folder_text = self.folder_var.get().strip()
        if not folder_text:
            messagebox.showwarning("Нет папки", "Сначала выберите папку с maFiles.")
            return

        folder = Path(folder_text)
        if not folder.exists() or not folder.is_dir():
            messagebox.showerror("Ошибка", "Указанная папка не существует.")
            return

        extracted = extract_from_mafiles(folder)
        if not extracted:
            self.output.insert(
                tk.END,
                "SteamID не найден. Проверьте файлы и формат JSON.\n",
            )
            return

        lines: list[str] = []
        all_ids: set[str] = set()
        for filename, ids in extracted.items():
            ids_text = ", ".join(sorted(ids))
            lines.append(f"{filename}: {ids_text}")
            all_ids.update(ids)

        output_file = write_steam_ids_to_file(folder, all_ids)

        lines.append("\nУникальные SteamID:")
        lines.extend(sorted(all_ids))
        lines.append(f"\nSteamID сохранены в файл: {output_file}")

        self.output.insert(tk.END, "\n".join(lines) + "\n")


def main() -> None:
    root = tk.Tk()
    app = SteamIdExtractorApp(root)
    _ = app
    root.mainloop()


if __name__ == "__main__":
    main()
