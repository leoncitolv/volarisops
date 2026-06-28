# Volaris Ops Telegram · Fix Firebase Auth

Este parche corrige el error:

`Firebase respondió 401 Unauthorized`

La base de Firebase Realtime Database requiere autenticación. Por eso GitHub Actions debe iniciar sesión con Firebase Auth antes de leer `volaris_notas`.

## Archivos a reemplazar

Sube/reemplaza en el repo:

- `.github/workflows/volaris-ops-telegram.yml`
- `scripts/check_ops_telegram.py`

## Secrets nuevos en GitHub

En `Settings > Secrets and variables > Actions > Secrets` agrega:

- `OPS_FIREBASE_API_KEY`
- `OPS_FIREBASE_AUTH_EMAIL`
- `OPS_FIREBASE_AUTH_PASSWORD`

Valores sugeridos:

- `OPS_FIREBASE_API_KEY`: la apiKey del proyecto `volaris-notas`.
- `OPS_FIREBASE_AUTH_EMAIL`: un usuario de Firebase Auth, por ejemplo `9999@volarisops.local`.
- `OPS_FIREBASE_AUTH_PASSWORD`: el PIN + `00`, por ejemplo si el PIN es `9999`, la contraseña es `999900`.

También deben existir:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Variable opcional

`OPS_FIREBASE_URL` si necesitas cambiar la ruta leída. Por defecto usa:

`https://volaris-notas-default-rtdb.firebaseio.com/volaris_notas.json`
