# Telegram Star

Профессиональная компактная панель Eel + Telethon для автоматизированного управления Telegram-аккаунтами.

## Главное

- Авто-импорт `.session` и `tdata` (запуск сразу после выбора файлов).
- Автоматическая проверка после добавления:
  - подключение
  - валидность
  - статус авторизации
  - ограничения/ошибки
- Компактный SaaS-интерфейс с быстрыми анимациями вкладок (fade/slide).
- Расширенные фильтры и статусы: `Connected`, `Checking`, `Invalid/Error`, `Limited`.
- Настройки по вкладкам: Тема / API / Устройства / Теги.
- 10 preset-профилей устройств авторизации для Telethon.

## Запуск

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Папки

- `sessions/` — рабочие session-файлы
- `imports/` — загруженные tdata bundles
- `exports/` — экспорт
