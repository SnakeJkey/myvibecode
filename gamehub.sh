#!/bin/bash
cd "$(dirname "$(readlink -f "$0")")" || exit 1

if [ ! -x node_modules/.bin/electron ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "Не найден Node.js (нужна версия 20 или новее). Установите его с https://nodejs.org"
    exit 1
  fi
  echo "Первый запуск: устанавливаю компоненты, это займёт 1-3 минуты..."
  npm install || { echo "Не удалось установить компоненты."; exit 1; }
fi

nohup ./node_modules/.bin/electron . --no-sandbox >/dev/null 2>&1 &
disown
