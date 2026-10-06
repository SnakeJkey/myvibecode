#!/bin/bash
cd "$(dirname "$0")" || exit 1

if [ ! -x node_modules/.bin/electron ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "Не найден Node.js, он нужен для первого запуска."
    echo "Сейчас откроется страница загрузки: скачайте версию LTS, установите её"
    echo "и запустите этот файл ещё раз."
    open "https://nodejs.org" 2>/dev/null
    read -r -p "Нажмите Enter, чтобы закрыть окно..." _
    exit 1
  fi
  echo "Первый запуск: устанавливаю компоненты, это займёт 1-3 минуты..."
  if ! npm install; then
    echo "Не удалось установить компоненты. Проверьте интернет и запустите файл ещё раз."
    read -r -p "Нажмите Enter, чтобы закрыть окно..." _
    exit 1
  fi
fi

nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
disown
