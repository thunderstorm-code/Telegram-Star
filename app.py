import asyncio
import json
import shutil
import zipfile
from pathlib import Path
from typing import Dict, Any, List

import eel
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "accounts.json"
SESSIONS_DIR = BASE_DIR / "sessions"
EXPORTS_DIR = BASE_DIR / "exports"

SESSIONS_DIR.mkdir(exist_ok=True)
EXPORTS_DIR.mkdir(exist_ok=True)

accounts: Dict[str, Dict[str, Any]] = {}
clients: Dict[str, TelegramClient] = {}


def load_accounts() -> None:
    global accounts
    if DATA_FILE.exists():
        accounts = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    else:
        accounts = {}


def save_accounts() -> None:
    DATA_FILE.write_text(json.dumps(accounts, ensure_ascii=False, indent=2), encoding="utf-8")


async def ensure_client(account_name: str) -> TelegramClient:
    if account_name not in accounts:
        raise ValueError("Аккаунт не найден")

    if account_name in clients:
        client = clients[account_name]
        if not client.is_connected():
            await client.connect()
        return client

    acc = accounts[account_name]
    session_path = SESSIONS_DIR / f"{account_name}.session"
    client = TelegramClient(str(session_path), int(acc["api_id"]), acc["api_hash"])
    await client.connect()
    clients[account_name] = client
    return client


@eel.expose
def list_accounts() -> List[Dict[str, Any]]:
    result = []
    for name, data in accounts.items():
        result.append(
            {
                "name": name,
                "phone": data.get("phone"),
                "authorized": data.get("authorized", False),
                "status": data.get("status", "clean" if data.get("authorized") else "unknown"),
            }
        )
    return result


@eel.expose
def add_account(name: str, api_id: str, api_hash: str, phone: str) -> Dict[str, Any]:
    if not all([name, api_id, api_hash, phone]):
        return {"ok": False, "error": "Заполните все поля"}

    if name in accounts:
        return {"ok": False, "error": "Аккаунт с таким именем уже есть"}

    accounts[name] = {
        "api_id": api_id,
        "api_hash": api_hash,
        "phone": phone,
        "authorized": False,
        "status": "unknown",
        "custom_tags": [],
    }
    save_accounts()
    return {"ok": True}


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

    accounts.pop(name, None)
    save_accounts()

    session_file = SESSIONS_DIR / f"{name}.session"
    if session_file.exists():
        session_file.unlink()

    client = clients.pop(name, None)
    if client:
        asyncio.run(client.disconnect())

    return {"ok": True}


@eel.expose
def request_code(name: str) -> Dict[str, Any]:
    async def _request() -> Dict[str, Any]:
        try:
            client = await ensure_client(name)
            phone = accounts[name]["phone"]
            await client.send_code_request(phone)
            return {"ok": True, "message": "Код отправлен"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return asyncio.run(_request())


@eel.expose
def sign_in(name: str, code: str, password: str = "") -> Dict[str, Any]:
    async def _sign_in() -> Dict[str, Any]:
        try:
            client = await ensure_client(name)
            phone = accounts[name]["phone"]
            try:
                await client.sign_in(phone=phone, code=code)
            except SessionPasswordNeededError:
                if not password:
                    return {"ok": False, "error": "Нужен пароль 2FA"}
                await client.sign_in(password=password)

            accounts[name]["authorized"] = await client.is_user_authorized()
            if accounts[name]["authorized"] and accounts[name].get("status") == "unknown":
                accounts[name]["status"] = "clean"
            save_accounts()
            return {"ok": True, "authorized": accounts[name]["authorized"]}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return asyncio.run(_sign_in())


@eel.expose
def fetch_dialogs(name: str, limit: int = 30) -> Dict[str, Any]:
    async def _fetch() -> Dict[str, Any]:
        try:
            client = await ensure_client(name)
            if not await client.is_user_authorized():
                return {"ok": False, "error": "Аккаунт не авторизован"}

            items = []
            async for dialog in client.iter_dialogs(limit=limit):
                items.append(
                    {
                        "id": dialog.id,
                        "title": dialog.title,
                        "unread": dialog.unread_count,
                    }
                )
            return {"ok": True, "dialogs": items}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return asyncio.run(_fetch())


@eel.expose
def get_account_profile(name: str) -> Dict[str, Any]:
    async def _profile() -> Dict[str, Any]:
        try:
            client = await ensure_client(name)
            auth = await client.is_user_authorized()
            if not auth:
                return {
                    "ok": True,
                    "profile": {
                        "name": name,
                        "phone": accounts[name].get("phone", "—"),
                        "username": "",
                        "id": "—",
                        "premium": False,
                        "status": accounts[name].get("status", "unknown"),
                        "dialogs": 0,
                        "authorized": False,
                    },
                }

            me = await client.get_me()
            dialogs_count = 0
            async for _ in client.iter_dialogs(limit=200):
                dialogs_count += 1

            return {
                "ok": True,
                "profile": {
                    "name": (f"{me.first_name or ''} {me.last_name or ''}").strip() or name,
                    "phone": f"+{me.phone}" if me.phone else accounts[name].get("phone", "—"),
                    "username": me.username or "",
                    "id": me.id,
                    "premium": bool(getattr(me, "premium", False)),
                    "status": accounts[name].get("status", "clean"),
                    "dialogs": dialogs_count,
                    "authorized": True,
                },
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return asyncio.run(_profile())


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

    return asyncio.run(_send())


@eel.expose
def export_account(name: str, fmt: str) -> Dict[str, Any]:
    if name not in accounts:
        return {"ok": False, "error": "Аккаунт не найден"}

    session_file = SESSIONS_DIR / f"{name}.session"
    if not session_file.exists():
        return {"ok": False, "error": "Сессия не найдена. Сначала авторизуйте аккаунт"}

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
                meta = {
                    "name": name,
                    "phone": accounts[name].get("phone"),
                    "note": "Demo export bundle. Real tdata conversion requires dedicated converter.",
                }
                meta_file = EXPORTS_DIR / f"{safe_name}_meta.json"
                meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
                zf.write(meta_file, arcname="meta.json")
                meta_file.unlink(missing_ok=True)
            return {"ok": True, "path": str(archive), "message": f"Экспорт готов: {archive.name}"}

        return {"ok": False, "error": "Неизвестный формат экспорта"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    load_accounts()
    eel.init("web")
    eel.start("index.html", size=(1380, 900), port=8000)
