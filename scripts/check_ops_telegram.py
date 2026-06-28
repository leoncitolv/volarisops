#!/usr/bin/env python3
"""Volaris Ops · notificaciones Telegram seguras.

Lee Firebase Realtime Database con REST, detecta notas nuevas, ítems palomeados y trabajos cerrados,
y envía mensajes por Telegram usando secretos de GitHub Actions.

No requiere paquetes externos.
"""
from __future__ import annotations

import html
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / ".ops_telegram_state.json"

DEFAULT_FIREBASE_URL = "https://volaris-notas-default-rtdb.firebaseio.com/volaris_notas.json"


def get_timezone():
    tz_name = os.getenv("APP_TIMEZONE", "America/Mexico_City")
    if ZoneInfo:
        try:
            return ZoneInfo(tz_name)
        except Exception:
            print(f"Zona horaria inválida {tz_name!r}. Uso UTC.")
    return timezone.utc


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def to_int_ms(value: Any) -> int:
    """Convierte timestamps de Firebase a milisegundos de forma tolerante."""
    if value is None:
        return 0
    try:
        if isinstance(value, (int, float)):
            return int(value)
        s = str(value).strip()
        if not s:
            return 0
        if s.isdigit():
            return int(s)
        return int(float(s))
    except Exception:
        return 0


def ts_from_entry_id(entry_id: str) -> int:
    """Extrae el timestamp de IDs tipo e_1710000000000_abc."""
    try:
        parts = str(entry_id).split("_")
        if len(parts) >= 2 and parts[0] == "e" and parts[1].isdigit():
            return int(parts[1])
    except Exception:
        pass
    return 0


def ms_to_dt(ms: Any, tz) -> datetime | None:
    try:
        return datetime.fromtimestamp(to_int_ms(ms) / 1000, tz=timezone.utc).astimezone(tz)
    except Exception:
        return None


def fmt_ms(ms: Any, tz) -> str:
    dt = ms_to_dt(ms, tz)
    if not dt:
        return "sin hora"
    return dt.strftime("%d/%m/%Y %H:%M")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        print(f"No pude leer {path.name}: {exc}. Uso estado vacío.")
        return default


def save_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")


def firebase_auth_token() -> str:
    """Obtiene un ID token de Firebase Auth si GitHub Secrets trae credenciales.

    Variables soportadas:
    - OPS_FIREBASE_ID_TOKEN: token ya generado manualmente, si deseas usarlo directo.
    - OPS_FIREBASE_API_KEY + OPS_FIREBASE_AUTH_EMAIL + OPS_FIREBASE_AUTH_PASSWORD:
      inicia sesión con Firebase Auth REST y devuelve idToken.
    """
    direct_token = os.getenv("OPS_FIREBASE_ID_TOKEN", "").strip()
    if direct_token:
        return direct_token

    api_key = os.getenv("OPS_FIREBASE_API_KEY", "").strip()
    email = os.getenv("OPS_FIREBASE_AUTH_EMAIL", "").strip()
    password = os.getenv("OPS_FIREBASE_AUTH_PASSWORD", "").strip()

    if not (api_key and email and password):
        return ""

    url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?" + urllib.parse.urlencode({"key": api_key})
    payload = json.dumps({
        "email": email,
        "password": password,
        "returnSecureToken": True,
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
        data = json.loads(body)
        token = str(data.get("idToken") or "").strip()
        if not token:
            raise RuntimeError("Firebase Auth no devolvió idToken.")
        print("Firebase Auth OK: sesión iniciada para lector Telegram.")
        return token
    except Exception as exc:
        raise RuntimeError(
            "No pude iniciar sesión en Firebase Auth. Revisa OPS_FIREBASE_API_KEY, "
            "OPS_FIREBASE_AUTH_EMAIL y OPS_FIREBASE_AUTH_PASSWORD. Error: " + str(exc)
        ) from exc


def with_auth_param(url: str, token: str) -> str:
    if not token:
        return url
    sep = "&" if "?" in url else "?"
    return url + sep + urllib.parse.urlencode({"auth": token})


def fetch_firebase() -> dict[str, Any]:
    base_url = os.getenv("OPS_FIREBASE_URL", DEFAULT_FIREBASE_URL).strip() or DEFAULT_FIREBASE_URL
    token = firebase_auth_token()
    url = with_auth_param(base_url, token)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        if exc.code == 401:
            raise RuntimeError(
                "Firebase respondió 401 Unauthorized. La base requiere autenticación. "
                "Agrega los Secrets OPS_FIREBASE_API_KEY, OPS_FIREBASE_AUTH_EMAIL y "
                "OPS_FIREBASE_AUTH_PASSWORD en GitHub Actions. Detalle: " + detail
            ) from exc
        raise

    data = json.loads(raw) if raw else {}
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError("Firebase devolvió un formato inesperado; esperaba objeto JSON.")
    return data


def telegram_send(text: str) -> bool:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en GitHub Secrets.")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            if resp.status >= 400:
                print(f"Telegram HTTP {resp.status}: {body}")
                return False
        return True
    except Exception as exc:
        print(f"Error mandando Telegram: {exc}")
        return False


def text_from_entry(entry: dict[str, Any]) -> str:
    items = entry.get("items")
    if isinstance(items, list) and items:
        lines = []
        for item in items:
            if isinstance(item, dict):
                mark = "✅" if item.get("done") else "♦️"
                txt = str(item.get("texto") or "").strip()
                if txt:
                    lines.append(f"{mark} {txt}")
        if lines:
            return "\n".join(lines)
    return str(entry.get("texto") or "").strip()


def creator_from_entry(entry: dict[str, Any]) -> str:
    name = str(entry.get("createdByName") or entry.get("deviceName") or "?").strip()
    num = str(entry.get("createdByNum") or "").strip()
    return f"{name} #{num}" if num else name


def closer_from_entry(entry: dict[str, Any]) -> str:
    name = str(entry.get("closedByName") or "").strip()
    num = str(entry.get("closedByNum") or "").strip()
    if name:
        return f"{name} #{num}" if num else name

    hist = entry.get("history")
    if isinstance(hist, list):
        for item in reversed(hist):
            if isinstance(item, dict) and item.get("action") == "cierra":
                hname = str(item.get("userName") or "?").strip()
                hnum = str(item.get("userNum") or "").strip()
                return f"{hname} #{hnum}" if hnum else hname
    return "?"


def closed_ts_from_entry(entry: dict[str, Any]) -> int | None:
    if entry.get("closedTs"):
        try:
            return to_int_ms(entry["closedTs"])
        except Exception:
            pass
    hist = entry.get("history")
    if isinstance(hist, list):
        for item in reversed(hist):
            if isinstance(item, dict) and item.get("action") == "cierra" and item.get("ts"):
                try:
                    return to_int_ms(item["ts"])
                except Exception:
                    return None
    return None


def is_entry_closed(entry: dict[str, Any]) -> bool:
    if bool(entry.get("deleted")):
        return False
    if bool(entry.get("done")):
        return True
    items = entry.get("items")
    if isinstance(items, list) and items:
        return all(bool(item.get("done")) for item in items if isinstance(item, dict))
    return False


def app_link() -> str:
    base = os.getenv("APP_BASE_URL", "").strip()
    return base


def build_created_message(mat: str, entry: dict[str, Any], tz) -> str:
    texto = text_from_entry(entry)
    urgent = texto.strip().startswith("⚠️")
    title = "🚨 <b>Nueva tarea creada · URGENTE</b>" if urgent else "🆕 <b>Nueva tarea creada</b>"
    lines = [
        "🛫 <b>Volaris Ops</b>",
        title,
        f"✈️ Matrícula: <b>{html.escape(mat)}</b>",
        f"👤 Por: {html.escape(creator_from_entry(entry))}",
        f"🕐 {html.escape(fmt_ms(entry.get('ts'), tz))}",
    ]
    if texto:
        lines.append("📝 " + html.escape(texto))
    if app_link():
        lines.append("Abrir app: " + html.escape(app_link()))
    return "\n".join(lines)


def build_closed_message(mat: str, entry: dict[str, Any], tz) -> str:
    texto = text_from_entry(entry)
    urgent = texto.strip().startswith("⚠️")
    title = "🚨 <b>Trabajo cerrado · URGENTE</b>" if urgent else "✅ <b>Trabajo cerrado</b>"
    cts = closed_ts_from_entry(entry)
    lines = [
        "🛫 <b>Volaris Ops</b>",
        title,
        f"✈️ Matrícula: <b>{html.escape(mat)}</b>",
        f"👤 Cerró: {html.escape(closer_from_entry(entry))}",
        f"🕐 {html.escape(fmt_ms(cts, tz))}",
    ]
    if texto:
        lines.append("📝 " + html.escape(texto))
    if app_link():
        lines.append("Abrir app: " + html.escape(app_link()))
    return "\n".join(lines)




def history_create_events(entry: dict[str, Any]) -> list[dict[str, Any]]:
    """Devuelve eventos de historial donde se creó una nota/tarea."""
    hist = entry.get("history")
    if not isinstance(hist, list):
        return []
    events: list[dict[str, Any]] = []
    for item in hist:
        if not isinstance(item, dict):
            continue
        if item.get("action") != "crea":
            continue
        if not to_int_ms(item.get("ts")):
            continue
        events.append(item)
    return events


def created_ts_from_entry(entry_id: str, entry: dict[str, Any]) -> int:
    """Obtiene la mejor hora de creación disponible.

    Algunas versiones de la app guardan `ts`; otras dejan la evidencia más clara
    en `history` con action='crea'. Como respaldo final, el id `e_<ts>_xxx`
    también contiene el timestamp.
    """
    for key in ("ts", "createdTs", "createdAt"):
        ts = to_int_ms(entry.get(key))
        if ts:
            return ts
    events = history_create_events(entry)
    if events:
        return to_int_ms(events[0].get("ts"))
    return ts_from_entry_id(entry_id)


def creator_from_history_event(event: dict[str, Any]) -> str:
    name = str(event.get("userName") or "?").strip()
    num = str(event.get("userNum") or "").strip()
    return f"{name} #{num}" if num else name


def build_created_message_from_event(mat: str, entry: dict[str, Any], event: dict[str, Any], tz) -> str:
    texto = text_from_entry(entry)
    urgent = texto.strip().startswith("⚠️")
    title = "🚨 <b>Nueva tarea creada · URGENTE</b>" if urgent else "🆕 <b>Nueva tarea creada</b>"
    lines = [
        "🛫 <b>Volaris Ops</b>",
        title,
        f"✈️ Matrícula: <b>{html.escape(mat)}</b>",
        f"👤 Por: {html.escape(creator_from_history_event(event))}",
        f"🕐 {html.escape(fmt_ms(event.get('ts'), tz))}",
    ]
    if texto:
        lines.append("📝 " + html.escape(texto))
    if app_link():
        lines.append("Abrir app: " + html.escape(app_link()))
    return "\n".join(lines)



def history_close_events(entry: dict[str, Any]) -> list[dict[str, Any]]:
    """Devuelve eventos de historial donde alguien marcó una tarea como realizada.

    La app VolarisOps registra action='cierra' cada vez que se palomea un ítem.
    Esto permite avisar incluso cuando la nota tiene varios ítems y todavía no todos están cerrados.
    """
    hist = entry.get("history")
    if not isinstance(hist, list):
        return []
    events: list[dict[str, Any]] = []
    for item in hist:
        if not isinstance(item, dict):
            continue
        if item.get("action") != "cierra":
            continue
        try:
            ts = int(item.get("ts") or 0)
        except Exception:
            ts = 0
        if not ts:
            continue
        events.append(item)
    return events


def user_from_history_event(event: dict[str, Any]) -> str:
    name = str(event.get("userName") or "?").strip()
    num = str(event.get("userNum") or "").strip()
    return f"{name} #{num}" if num else name


def build_item_closed_message(mat: str, entry: dict[str, Any], event: dict[str, Any], tz) -> str:
    texto = text_from_entry(entry)
    urgent = texto.strip().startswith("⚠️")
    title = "🚨 <b>Ítem realizado · URGENTE</b>" if urgent else "✅ <b>Ítem marcado como realizado</b>"
    lines = [
        "🛫 <b>Volaris Ops</b>",
        title,
        f"✈️ Matrícula: <b>{html.escape(mat)}</b>",
        f"👤 Por: {html.escape(user_from_history_event(event))}",
        f"🕐 {html.escape(fmt_ms(event.get('ts'), tz))}",
    ]
    if texto:
        lines.append("📝 " + html.escape(texto))
    if app_link():
        lines.append("Abrir app: " + html.escape(app_link()))
    return "\n".join(lines)


def iter_entries(data: dict[str, Any]):
    for mat_key, meta in data.items():
        if not isinstance(meta, dict):
            continue
        if meta.get("deleted"):
            continue
        mat = str(meta.get("nombre") or mat_key).strip().upper()
        entries = meta.get("entries") or {}
        if isinstance(entries, list):
            entries_iter = [(str(en.get("id") or idx), en) for idx, en in enumerate(entries) if isinstance(en, dict)]
        elif isinstance(entries, dict):
            entries_iter = [(str(entry_id), entry) for entry_id, entry in entries.items() if isinstance(entry, dict)]
        else:
            continue
        for entry_id, entry in entries_iter:
            if entry.get("deleted"):
                continue
            if not entry.get("id"):
                entry = {**entry, "id": entry_id}
            yield str(mat_key), mat, entry_id, entry


def main() -> int:
    tz = get_timezone()
    state: dict[str, Any] = load_json(STATE_FILE, {})
    first_run = not bool(state.get("initialized"))
    first_window_min = int(os.getenv("OPS_FIRST_RUN_LOOKBACK_MINUTES", "180"))
    cutoff = now_ms() - first_window_min * 60 * 1000

    data = fetch_firebase()
    entries = list(iter_entries(data))
    print(f"Volaris Ops revisando {len(entries)} nota(s). first_run={first_run}")

    sent = 0
    seen_created = 0
    seen_closed = 0

    for mat_key, mat, entry_id, entry in entries:
        created_ts = created_ts_from_entry(entry_id, entry)
        created_key = f"created|{mat_key}|{entry_id}|{created_ts}"
        primary_created_sent_this_run = False
        if created_ts and not state.get(created_key):
            seen_created += 1
            should_send = (not first_run) or created_ts >= cutoff
            print(f"Nueva nota detectada por entry.ts/id: {mat} / {entry_id} / ts={created_ts} / enviar={should_send}")
            if should_send:
                if telegram_send(build_created_message(mat, entry, tz)):
                    sent += 1
                    primary_created_sent_this_run = True
                    state[created_key] = {"mat": mat, "entry_id": entry_id, "ts": created_ts, "type": "created"}
                else:
                    print("No marco como enviada la creación porque Telegram falló; se reintentará.")
            else:
                state[created_key] = {"mat": mat, "entry_id": entry_id, "ts": created_ts, "type": "created_seen_first_run"}

        # 0b) Respaldo: detectar creación desde history.action='crea'.
        # Esto corrige casos donde la creación quedó registrada en historial pero
        # una versión anterior del detector no mandó alerta de nueva tarea.
        for ev in history_create_events(entry):
            hts = to_int_ms(ev.get("ts"))
            h_created_key = f"history_created|{mat_key}|{entry_id}|{hts}"
            if state.get(h_created_key):
                continue
            if primary_created_sent_this_run:
                state[h_created_key] = {"mat": mat, "entry_id": entry_id, "ts": hts, "type": "history_created_linked"}
                continue
            # Como este detector se agregó después, no queremos inundar el grupo con
            # notas antiguas. Solo manda creaciones de historial dentro de la ventana
            # reciente configurada por OPS_FIRST_RUN_LOOKBACK_MINUTES.
            should_send = hts >= cutoff
            print(f"Nueva nota detectada por historial: {mat} / {entry_id} / ts={hts} / enviar={should_send}")
            if should_send:
                if telegram_send(build_created_message_from_event(mat, entry, ev, tz)):
                    sent += 1
                    state[h_created_key] = {"mat": mat, "entry_id": entry_id, "ts": hts, "type": "history_created"}
                else:
                    print("No marco como enviada la creación de historial porque Telegram falló; se reintentará.")
            else:
                state[h_created_key] = {"mat": mat, "entry_id": entry_id, "ts": hts, "type": "history_created_old_seen"}

        # 1) Aviso por cada palomita/cierre registrado en history.
        # Esto cubre notas con varios ítems donde solo se cerró uno.
        for ev in history_close_events(entry):
            cts = to_int_ms(ev.get("ts"))
            closed_key = f"history_closed|{mat_key}|{entry_id}|{cts}"
            if state.get(closed_key):
                continue
            seen_closed += 1
            should_send = (not first_run) or cts >= cutoff
            print(f"Cierre/ítem detectado: {mat} / {entry_id} / ts={cts} / enviar={should_send}")
            if should_send:
                if telegram_send(build_item_closed_message(mat, entry, ev, tz)):
                    sent += 1
            state[closed_key] = {"mat": mat, "entry_id": entry_id, "ts": cts, "type": "history_closed"}

        # 2) Aviso de trabajo totalmente cerrado si todos los ítems quedaron listos.
        # Se conserva para distinguir cierre total de cierre parcial.
        if is_entry_closed(entry):
            cts = closed_ts_from_entry(entry)
            if cts:
                closed_key = f"closed|{mat_key}|{entry_id}|{cts}"
                if not state.get(closed_key):
                    seen_closed += 1
                    should_send = (not first_run) or cts >= cutoff
                    print(f"Trabajo completo detectado: {mat} / {entry_id} / ts={cts} / enviar={should_send}")
                    if should_send:
                        if telegram_send(build_closed_message(mat, entry, tz)):
                            sent += 1
                    state[closed_key] = {"mat": mat, "entry_id": entry_id, "ts": cts, "type": "closed"}

    state["initialized"] = True
    state["last_checked_at"] = datetime.now(tz).isoformat()
    state["last_summary"] = {"entries": len(entries), "new_created_keys": seen_created, "new_closed_keys": seen_closed, "sent": sent}
    save_json(STATE_FILE, state)

    print(f"Alertas enviadas: {sent}")
    print(f"Nuevas claves registradas: creadas={seen_created}, cerradas={seen_closed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
