# Volaris Ops · Telegram seguro

Esta actualización activa avisos por Telegram sin poner el token ni el chat ID dentro del HTML.

## Qué hace

GitHub Actions revisa Firebase cada 5 minutos y manda Telegram cuando detecta:

- Una nota/tarea nueva.
- Un trabajo/tarea cerrada.

El flujo queda así:

```text
VolarisOps.html → Firebase Realtime Database
GitHub Actions → lee Firebase → Telegram Bot → iPhone/grupo
```

## Archivos agregados

```text
.github/workflows/volaris-ops-telegram.yml
scripts/check_ops_telegram.py
LEEME_TELEGRAM_VOL_OPS.md
```

Cuando se ejecute por primera vez, GitHub también puede crear:

```text
.ops_telegram_state.json
```

Ese archivo evita duplicar avisos.

## Secrets necesarios

En el repo:

```text
Settings → Secrets and variables → Actions → Secrets
```

Crea:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Usa el bot que ya tienes creado. El `chat_id` puede ser tu chat personal o un grupo.

## Variables opcionales

En:

```text
Settings → Secrets and variables → Actions → Variables
```

Puedes crear:

```text
APP_TIMEZONE = America/Mexico_City
APP_BASE_URL = https://leoncitolv.github.io/volarisops/VolarisOps.html
OPS_FIRST_RUN_LOOKBACK_MINUTES = 180
```

`OPS_FIRST_RUN_LOOKBACK_MINUTES` evita que en la primera corrida se manden alertas de todo el histórico. Por defecto solo avisa lo creado/cerrado en las últimas 3 horas y registra lo anterior como ya revisado.

## Cómo probar

1. Sube estos archivos al mismo repo de Volaris Ops.
2. Agrega los Secrets.
3. Ve a:

```text
Actions → Volaris Ops Telegram → Run workflow
```

4. Crea una nota nueva o cierra una tarea en Volaris Ops.
5. Espera la siguiente corrida automática o usa `Run workflow` otra vez.

## Importante

GitHub Actions no es instantáneo. Revisa cada 5 minutos y a veces GitHub puede retrasar la ejecución. Para operación normal es suficiente, pero no es una alarma crítica al segundo exacto.

El HTML queda sin token, sin chat ID y sin credenciales privadas.
