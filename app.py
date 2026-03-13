import asyncio
import base64
import hashlib
import json
import shutil
import threading
import zipfile
from pathlib import Path
from typing import Dict, Any, List

import eel
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError, FloodWaitError

BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "accounts.json"
SETTINGS_FILE = BASE_DIR / "app_settings.json"
SESSIONS_DIR = BASE_DIR / "sessions"
EXPORTS_DIR = BASE_DIR / "exports"
IMPORTS_DIR = BASE_DIR / "imports"

SESSIONS_DIR.mkdir(exist_ok=True)
EXPORTS_DIR.mkdir(exist_ok=True)
IMPORTS_DIR.mkdir(exist_ok=True)

accounts: Dict[str, Dict[str, Any]] = {}
clients: Dict[str, TelegramClient] = {}
pending_registrations: Dict[str, Dict[str, Any]] = {}
app_settings: Dict[str, Any] = {}

LOOP = asyncio.new_event_loop()
threading.Thread(target=LOOP.run_forever, daemon=True).start()


def run_async(coro):
    return asyncio.run_coroutine_threadsafe(coro, LOOP).result()


DEVICE_PRESETS = [
    {"id": "tdesktop_pc", "title": "TDesktop", "category": "pc", "app_id": 2040, "app_hash": "b18441a1ff607e10a989891a5462e627", "device_model": "Windows PC", "system_version": "Windows 11", "app_version": "4.16", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "distributed_android_phone", "title": "Distributed Android", "category": "phone", "app_id": 6, "app_hash": "eb06d4abfb49dc3eeb1aeb98ae0f581e", "device_model": "Pixel 8", "system_version": "Android 14", "app_version": "11.0", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "public_static_final_pc", "title": "Public Static Final", "category": "pc", "app_id": 5, "app_hash": "1c5c96d5edd401b1ed40db3fb5633e2d", "device_model": "Desktop", "system_version": "Windows 10", "app_version": "10.7", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "public_android_beta_phone", "title": "Public Android Beta", "category": "phone", "app_id": 4, "app_hash": "014b35b6184100b085b0d0572f9b5103", "device_model": "Samsung S23", "system_version": "Android 14", "app_version": "11.0-beta", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "telegram_x_phone", "title": "Telegram X", "category": "phone", "app_id": 21724, "app_hash": "3e0cb5efcd52300aec5994fdfc5bdc16", "device_model": "Xiaomi 13", "system_version": "Android 14", "app_version": "0.26", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "public_ios_beta_phone", "title": "Public iOS Beta", "category": "phone", "app_id": 8, "app_hash": "7245de8e747a0d6fbe11f7cc14fcc0bb", "device_model": "iPhone 15 Pro", "system_version": "iOS 17", "app_version": "10.8", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "public_macos_beta_laptop", "title": "Public MacOs Beta", "category": "laptop", "app_id": 2834, "app_hash": "68875f756c9b437a8b916ca3de215815", "device_model": "MacBook Pro", "system_version": "macOS 14", "app_version": "10.8-beta", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "web_telegram_laptop", "title": "Web Telegram", "category": "laptop", "app_id": 2496, "app_hash": "8da85b0d5bfe62527e5b244c209159c3", "device_model": "Chromebook", "system_version": "ChromeOS", "app_version": "web-k", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "telegram_swift_phone", "title": "Telegram Swift", "category": "phone", "app_id": 10840, "app_hash": "33c45224029d59cb3ad0c16134215aeb", "device_model": "iPhone 14", "system_version": "iOS 17", "app_version": "10.6", "lang_code": "ru", "system_lang_code": "ru-RU"},
    {"id": "public_unknown_beta_pc", "title": "Public Unknown Beta", "category": "pc", "app_id": 9, "app_hash": "3975f648bb682ee889f35483bc618d1c", "device_model": "Linux Desktop", "system_version": "Ubuntu 24.04", "app_version": "beta", "lang_code": "ru", "system_lang_code": "ru-RU"},
]


def default_settings() -> Dict[str, Any]:
    base = DEVICE_PRESETS[0]
    return {"theme": "gray", "api_id": str(base["app_id"]), "api_hash": base["app_hash"], "device_preset": base["id"]}


def get_preset(preset_id: str) -> Dict[str, Any]:
    return next((p for p in DEVICE_PRESETS if p["id"] == preset_id), DEVICE_PRESETS[0])


def load_accounts() -> None:
    global accounts
    accounts = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}


def save_accounts() -> None:
    DATA_FILE.write_text(json.dumps(accounts, ensure_ascii=False, indent=2), encoding="utf-8")


def load_settings() -> None:
    global app_settings
    if SETTINGS_FILE.exists():
        app_settings = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    else:
        app_settings = default_settings()
        save_settings()


def save_settings() -> None:
    SETTINGS_FILE.write_text(json.dumps(app_settings, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_client_params(account_name: str) -> Dict[str, Any]:
    acc = accounts[account_name]
    preset = get_preset(app_settings.get("device_preset", DEVICE_PRESETS[0]["id"]))
    api_id = acc.get("api_id") or app_settings.get("api_id") or str(preset["app_id"])
    api_hash = acc.get("api_hash") or app_settings.get("api_hash") or preset["app_hash"]
    if not api_id or not api_hash:
        raise ValueError("Не настроены API данные")
    return {
        "api_id": int(api_id),
        "api_hash": api_hash,
        "device_model": preset["device_model"],
        "system_version": preset["system_version"],
        "app_version": preset["app_version"],
        "lang_code": preset["lang_code"],
        "system_lang_code": preset["system_lang_code"],
    }


async def ensure_client(account_name: str) -> TelegramClient:
    if account_name not in accounts:
        raise ValueError("Аккаунт не найден")

    if account_name in clients:
        client = clients[account_name]
        if not client.is_connected():
            await client.connect()
        return client

    cfg = resolve_client_params(account_name)
    session_path = SESSIONS_DIR / f"{account_name}.session"
    client = TelegramClient(
        str(session_path), cfg["api_id"], cfg["api_hash"],
        device_model=cfg["device_model"], system_version=cfg["system_version"],
        app_version=cfg["app_version"], lang_code=cfg["lang_code"], system_lang_code=cfg["system_lang_code"],
    )
    await client.connect()
    clients[account_name] = client
    return client


def session_hash_exists(hash_value: str) -> bool:
    return any(acc.get("session_hash") == hash_value for acc in accounts.values())


async def _check_account_async(name: str) -> Dict[str, Any]:
    if name not in accounts:
        return {"ok": False, "error": "Аккаунт не найден"}

    accounts[name]["connection_state"] = "checking"
    accounts[name]["last_error"] = ""
    save_accounts()

    try:
        client = await ensure_client(name)
        auth = await client.is_user_authorized()
        accounts[name]["authorized"] = bool(auth)
        accounts[name]["active"] = True
        accounts[name]["limits"] = "ok"

        if auth:
            me = await client.get_me()
            accounts[name]["username"] = me.username or ""
            accounts[name]["profile_id"] = str(me.id)
            accounts[name]["profile_name"] = (f"{me.first_name or ''} {me.last_name or ''}").strip() or (me.username or name)
            accounts[name]["premium"] = bool(getattr(me, "premium", False))
            accounts[name]["connection_state"] = "active"
            if accounts[name].get("status", "unknown") == "unknown":
                accounts[name]["status"] = "clean"
        else:
            accounts[name]["connection_state"] = "invalid"
            accounts[name]["limits"] = "auth_required"

        save_accounts()
        return {"ok": True, "state": accounts[name]["connection_state"]}
    except FloodWaitError as e:
        accounts[name]["connection_state"] = "limited"
        accounts[name]["limits"] = f"flood_wait_{e.seconds}s"
        accounts[name]["last_error"] = str(e)
        save_accounts()
        return {"ok": False, "state": "limited", "error": str(e)}
    except Exception as e:
        accounts[name]["connection_state"] = "error"
        accounts[name]["active"] = False
        accounts[name]["last_error"] = str(e)
        accounts[name]["limits"] = "error"
        save_accounts()
        return {"ok": False, "state": "error", "error": str(e)}


@eel.expose
def check_account(name: str) -> Dict[str, Any]:
    return run_async(_check_account_async(name))


@eel.expose
def list_accounts() -> List[Dict[str, Any]]:
    return [
        {
            "name": name,
            "display_name": data.get("profile_name") or name,
            "id": data.get("profile_id", ""),
            "phone": data.get("phone"),
            "authorized": data.get("authorized", False),
            "status": data.get("status", "unknown"),
            "username": data.get("username", ""),
            "premium": data.get("premium", False),
            "has2fa": data.get("has2fa", False),
            "source": data.get("source", "session"),
            "connection_state": data.get("connection_state", "unknown"),
            "limits": data.get("limits", "—"),
            "proxy": data.get("proxy", "—"),
            "active": data.get("active", False),
            "last_error": data.get("last_error", ""),
        }
        for name, data in accounts.items()
    ]


@eel.expose
def get_settings() -> Dict[str, Any]:
    return {"ok": True, "settings": app_settings}


@eel.expose
def update_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    for key in ["theme", "api_id", "api_hash", "device_preset"]:
        if key in payload:
            app_settings[key] = payload[key]
    save_settings()
    return {"ok": True}


@eel.expose
def list_device_presets() -> Dict[str, Any]:
    return {"ok": True, "presets": DEVICE_PRESETS}


@eel.expose
def import_session_files(prefix: str, files: List[Dict[str, str]]) -> Dict[str, Any]:
    if not files:
        return {"ok": False, "error": "Файлы не переданы"}

    imported, skipped = [], []
    for item in files:
        fname = item.get("name", "")
        if not fname.endswith(".session"):
            continue

        raw = base64.b64decode(item.get("data", ""))
        h = hashlib.sha256(raw).hexdigest()
        if session_hash_exists(h):
            skipped.append(fname)
            continue

        stem = Path(fname).stem
        account_name = f"{prefix}_{stem}" if prefix else stem
        account_name = "".join(c for c in account_name if c.isalnum() or c in ("-", "_"))
        if not account_name:
            continue
        while account_name in accounts:
            account_name += "_new"

        (SESSIONS_DIR / f"{account_name}.session").write_bytes(raw)
        accounts[account_name] = {
            "api_id": app_settings.get("api_id", ""), "api_hash": app_settings.get("api_hash", ""),
            "phone": "", "authorized": False, "status": "unknown", "source": "session",
            "connection_state": "idle", "active": False, "limits": "—", "proxy": "—", "session_hash": h,
            "profile_name": account_name, "profile_id": "", "username": "",
        }
        imported.append(account_name)

    save_accounts()
    return {"ok": True, "count": len(imported), "accounts": imported, "skipped": skipped}


@eel.expose
def import_tdata_files(bundle_name: str, files: List[Dict[str, str]]) -> Dict[str, Any]:
    if not files:
        return {"ok": False, "error": "Папка tdata пуста"}

    root = IMPORTS_DIR / (bundle_name or "tdata_bundle")
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)

    session_like = []
    for item in files:
        rel = item.get("name", "")
        if not rel:
            continue
        out = root / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(base64.b64decode(item.get("data", "")))
        if out.suffix == ".session":
            session_like.append(out)

    imported, skipped = [], []
    for s in session_like:
        raw = s.read_bytes()
        h = hashlib.sha256(raw).hexdigest()
        if session_hash_exists(h):
            skipped.append(s.name)
            continue

        account_name = f"{bundle_name}_{s.stem}" if bundle_name else s.stem
        account_name = "".join(c for c in account_name if c.isalnum() or c in ("-", "_"))
        if not account_name:
            continue
        while account_name in accounts:
            account_name += "_new"

        shutil.copy2(s, SESSIONS_DIR / f"{account_name}.session")
        accounts[account_name] = {
            "api_id": app_settings.get("api_id", ""), "api_hash": app_settings.get("api_hash", ""),
            "phone": "", "authorized": False, "status": "unknown", "source": "tdata",
            "connection_state": "idle", "active": False, "limits": "—", "proxy": "—", "session_hash": h,
            "profile_name": account_name, "profile_id": "", "username": "",
        }
        imported.append(account_name)

    save_accounts()
    return {"ok": True, "message": "tdata импортирована", "imported": imported, "skipped": skipped, "path": str(root)}




@eel.expose
def register_account_start(session_name: str, phone: str) -> Dict[str, Any]:
    async def _start() -> Dict[str, Any]:
        try:
            name = (session_name or '').strip()
            if not name:
                return {"ok": False, "error": "Укажите имя сессии"}
            if not phone:
                return {"ok": False, "error": "Укажите номер телефона"}
            if name in accounts:
                return {"ok": False, "error": "Сессия с таким именем уже существует"}

            preset = get_preset(app_settings.get("device_preset", DEVICE_PRESETS[0]["id"]))
            api_id = app_settings.get("api_id") or str(preset["app_id"])
            api_hash = app_settings.get("api_hash") or preset["app_hash"]
            if not api_id or not api_hash:
                return {"ok": False, "error": "Заполните API в настройках"}

            cfg = {
                "api_id": int(api_id),
                "api_hash": api_hash,
                "device_model": preset["device_model"],
                "system_version": preset["system_version"],
                "app_version": preset["app_version"],
                "lang_code": preset["lang_code"],
                "system_lang_code": preset["system_lang_code"],
            }

            session_path = SESSIONS_DIR / f"{name}.session"
            client = TelegramClient(
                str(session_path), cfg["api_id"], cfg["api_hash"],
                device_model=cfg["device_model"], system_version=cfg["system_version"],
                app_version=cfg["app_version"], lang_code=cfg["lang_code"], system_lang_code=cfg["system_lang_code"],
            )
            await client.connect()
            await client.send_code_request(phone)
            pending_registrations[name] = {"phone": phone}
            clients[name] = client
            return {"ok": True, "message": "Код отправлен"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return run_async(_start())


@eel.expose
def register_account_finish(session_name: str, code: str, password: str = "") -> Dict[str, Any]:
    async def _finish() -> Dict[str, Any]:
        try:
            name = (session_name or '').strip()
            if name not in pending_registrations:
                return {"ok": False, "error": "Сначала запросите код"}

            client = await ensure_client(name) if name in accounts else clients.get(name)
            if not client:
                return {"ok": False, "error": "Клиент не инициализирован"}

            phone = pending_registrations[name]["phone"]
            try:
                await client.sign_in(phone=phone, code=code)
            except SessionPasswordNeededError:
                if not password:
                    return {"ok": False, "need_password": True, "error": "Нужен пароль 2FA"}
                await client.sign_in(password=password)

            me = await client.get_me()
            session_file = SESSIONS_DIR / f"{name}.session"
            h = hashlib.sha256(session_file.read_bytes()).hexdigest() if session_file.exists() else ''
            if session_hash_exists(h):
                await client.disconnect()
                clients.pop(name, None)
                pending_registrations.pop(name, None)
                return {"ok": False, "error": "Такая сессия уже загружена"}

            accounts[name] = {
                "api_id": app_settings.get("api_id", ""),
                "api_hash": app_settings.get("api_hash", ""),
                "phone": phone,
                "authorized": True,
                "status": "clean",
                "source": "registered",
                "connection_state": "active",
                "active": True,
                "limits": "ok",
                "proxy": "—",
                "session_hash": h,
                "profile_name": (f"{me.first_name or ''} {me.last_name or ''}").strip() or (me.username or name),
                "profile_id": str(me.id),
                "username": me.username or "",
                "premium": bool(getattr(me, "premium", False)),
            }
            save_accounts()
            pending_registrations.pop(name, None)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return run_async(_finish())


@eel.expose
def set_account_status(name: str, status: str) -> Dict[str, Any]:
    if name not in accounts:
        return {"ok": False, "error": "Аккаунт не найден"}
    accounts[name]["status"] = status
    save_accounts()
    return {"ok": True}


@eel.expose
def remove_account(name: str) -> Dict[str, Any]:
    if name not in accounts:
        return {"ok": False, "error": "Аккаунт не найден"}

    async def _remove() -> Dict[str, Any]:
        client = clients.pop(name, None)
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass
        return {"ok": True}

    run_async(_remove())

    accounts.pop(name, None)
    save_accounts()

    session_file = SESSIONS_DIR / f"{name}.session"
    if session_file.exists():
        session_file.unlink()

    return {"ok": True}


@eel.expose
def request_code(name: str) -> Dict[str, Any]:
    async def _request() -> Dict[str, Any]:
        try:
            client = await ensure_client(name)
            phone = accounts[name].get("phone")
            if not phone:
                return {"ok": False, "error": "Для запроса кода нужен phone"}
            await client.send_code_request(phone)
            return {"ok": True, "message": "Код отправлен"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return run_async(_request())


@eel.expose
def sign_in(name: str, code: str, password: str = "") -> Dict[str, Any]:
    async def _sign_in() -> Dict[str, Any]:
        try:
            client = await ensure_client(name)
            phone = accounts[name].get("phone")
            if phone and code:
                try:
                    await client.sign_in(phone=phone, code=code)
                except SessionPasswordNeededError:
                    if not password:
                        return {"ok": False, "need_password": True, "error": "Нужен пароль 2FA"}
                    await client.sign_in(password=password)
            elif password:
                await client.sign_in(password=password)
            return await _check_account_async(name)
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return run_async(_sign_in())


@eel.expose
def fetch_dialogs(name: str, limit: int = 30) -> Dict[str, Any]:
    async def _fetch() -> Dict[str, Any]:
        try:
            client = await ensure_client(name)
            if not await client.is_user_authorized():
                return {"ok": False, "error": "Аккаунт не авторизован"}
            items = []
            async for dialog in client.iter_dialogs(limit=limit):
                items.append({"id": dialog.id, "title": dialog.title, "unread": dialog.unread_count})
            return {"ok": True, "dialogs": items}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return run_async(_fetch())


@eel.expose
def get_account_profile(name: str) -> Dict[str, Any]:
    async def _profile() -> Dict[str, Any]:
        try:
            client = await ensure_client(name)
            auth = await client.is_user_authorized()
            if not auth:
                return {"ok": True, "profile": {
                    "name": accounts[name].get("profile_name", name), "phone": accounts[name].get("phone", "—"),
                    "username": accounts[name].get("username", ""), "id": accounts[name].get("profile_id", "—"),
                    "premium": accounts[name].get("premium", False), "status": accounts[name].get("status", "unknown"),
                    "dialogs": 0, "authorized": False,
                }}

            me = await client.get_me()
            dialogs_count = 0
            async for _ in client.iter_dialogs(limit=200):
                dialogs_count += 1
            return {"ok": True, "profile": {
                "name": (f"{me.first_name or ''} {me.last_name or ''}").strip() or accounts[name].get("profile_name", name),
                "phone": f"+{me.phone}" if me.phone else accounts[name].get("phone", "—"),
                "username": me.username or "", "id": str(me.id), "premium": bool(getattr(me, "premium", False)),
                "status": accounts[name].get("status", "clean"), "dialogs": dialogs_count, "authorized": True,
            }}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return run_async(_profile())


@eel.expose
def send_message(name: str, target: str, text: str) -> Dict[str, Any]:
    async def _send() -> Dict[str, Any]:
        try:
            if not target or not text:
                return {"ok": False, "error": "Укажите получателя и текст"}
            client = await ensure_client(name)
            if not await client.is_user_authorized():
                return {"ok": False, "error": "Аккаунт не авторизован"}
            await client.send_message(target, text)
            return {"ok": True, "message": "Сообщение отправлено"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return run_async(_send())


@eel.expose
def export_account(name: str, fmt: str) -> Dict[str, Any]:
    if name not in accounts:
        return {"ok": False, "error": "Аккаунт не найден"}

    session_file = SESSIONS_DIR / f"{name}.session"
    if not session_file.exists():
        return {"ok": False, "error": "Сессия не найдена"}

    fmt = (fmt or "").lower()
    safe_name = "".join(c for c in name if c.isalnum() or c in ("-", "_")) or "account"

    try:
        if fmt in {"telethon", "pyrogram"}:
            target = EXPORTS_DIR / f"{safe_name}_{fmt}.session"
            shutil.copy2(session_file, target)
            return {"ok": True, "path": str(target), "message": f"Экспорт готов: {target.name}"}
        if fmt == "tdata":
            archive = EXPORTS_DIR / f"{safe_name}_tdata.zip"
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.write(session_file, arcname=f"{safe_name}.session")
            return {"ok": True, "path": str(archive), "message": f"Экспорт готов: {archive.name}"}
        return {"ok": False, "error": "Неизвестный формат"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    load_accounts()
    load_settings()
    eel.init("web")
    eel.start("index.html", size=(1420, 920), port=8000)
