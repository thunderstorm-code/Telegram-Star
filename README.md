# Telegram Star

Telegram Star — desktop-панель в стиле mini-app на **Eel + Telethon**.

## Что умеет

- Импорт аккаунтов из `.session` файлов.
- Импорт папки `tdata` (папка сохраняется как bundle, автоподхватываются найденные `.session`).
- Полный Telethon workflow: запрос кода, вход (2FA), просмотр диалогов, отправка сообщений.
- Экспорт аккаунтов: `telethon`, `pyrogram`, `tdata`.
- Фильтры аккаунтов (статусы + расширенные tri-state фильтры).
- Настройки с отдельными вкладками:
  - Тема (серый/желтый/голубой)
  - API
  - Устройства авторизации (10 готовых шаблонов)
  - Теги

## Запуск

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Папки

- `sessions/` — рабочие telethon session файлы.
- `imports/` — загруженные tdata bundles.
- `exports/` — экспортированные файлы.
