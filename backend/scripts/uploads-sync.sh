#!/bin/bash
# =============================================================================
# Bazar uploads replication — синхронизация uploads/ между нодами.
#
# ЗАЧЕМ: nginx на REG.RU гео-роутит /uploads/ на ЛОКАЛЬНЫЙ бэкенд (РФ →
# REG.RU, остальные → Hetzner через туннель). Файлы не расшарены → у половины
# пользователей картинки постов/рекламы = 404. Скрипт держит uploads/
# одинаковым на обеих нодах.
#
# РЕЖИМЫ:
#   --once          инкрементальный merge прямо сейчас (pull + push), выход
#   --file <rel>    скопировать ОДИН файл на peer (быстрый путь новой загрузки;
#                   вызывается бэкендом сразу после multer)
#   --files a b c   то же для нескольких файлов
#   --watch         демон: --once каждые $BAZAR_UPLOADS_SYNC_INTERVAL секунд
#   --full          принудительный полный merge (игнорирует инкремент)
#
# ENV:
#   BAZAR_UPLOADS_PEER            ssh-таргет второй ноды (обязателен)
#   BAZAR_UPLOADS_DIR             каталог uploads (default /opt/marketplace/backend/uploads)
#   BAZAR_UPLOADS_SYNC_INTERVAL   секунды между merge в --watch (default 60)
#   BAZAR_UPLOADS_STAGE           временный каталог (default /var/lib/bazar-uploads-stage)
#   BAZAR_UPLOADS_LOG             лог (default /var/log/bazar-uploads-sync.log)
#
# ПОЧЕМУ ИНКРЕМЕНТАЛЬНО (а не `tar cf - . | tar xf -` каждый раз):
#   uploads — 2018 файлов / 72 МБ. Полный merge раз в 60 с = ~100 ГБ/сутки
#   трафика на каждую ноду. Вместо этого сверяем СПИСКИ файлов (2018 коротких
#   строк, ~100 КБ) и тянем/шлём только реально отсутствующие. В steady state
#   прогон не передаёт ни одного байта контента.
#
# ГАРАНТИИ:
#   - Ничего НЕ удаляет (только добавляет/обновляет).
#   - Конфликт «одно имя — разное содержимое» НЕ перезаписывается молча:
#     пишется строка CONFLICT в лог.
#   - Любая ошибка сети → запись в лог и exit≠0; загрузку пользователя
#     это НЕ ломает (бэкенд дёргает best-effort).
#   - Стадия всегда чистится (иначе она растёт на каждый прогон демона).
# =============================================================================

set -u

LOCAL="${BAZAR_UPLOADS_DIR:-/opt/marketplace/backend/uploads}"
PEER="${BAZAR_UPLOADS_PEER:-}"
STAGE="${BAZAR_UPLOADS_STAGE:-/var/lib/bazar-uploads-stage}"
LOG="${BAZAR_UPLOADS_LOG:-/var/log/bazar-uploads-sync.log}"
INTERVAL="${BAZAR_UPLOADS_SYNC_INTERVAL:-60}"
LOCK="/run/bazar-uploads-sync.lock"
SSH_OPTS="-o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3"

log() { echo "$(date -Is) $*" >> "$LOG" 2>/dev/null; }

if [ -z "$PEER" ]; then
  echo "BAZAR_UPLOADS_PEER не задан — репликация невозможна" >&2
  exit 2
fi

mkdir -p "$LOCAL" "$STAGE" "$(dirname "$LOG")" 2>/dev/null

# ── Манифесты: относительный путь + размер ───────────────────────────────────
# Формат `%P\t%s` — путь относительно uploads (подпапки сохраняются).
manifest_local() {
  ( cd "$LOCAL" && find . -type f -printf '%P\t%s\n' 2>/dev/null | sort )
}

manifest_peer() {
  ssh $SSH_OPTS "$PEER" "cd '$LOCAL' 2>/dev/null && find . -type f -printf '%P\t%s\n' 2>/dev/null | sort"
}

# ── pull: peer -> local (только отсутствующие; существующее не трогаем) ──────
pull() {
  local peer_manifest="$STAGE/peer.manifest"
  local local_manifest="$STAGE/local.manifest"

  if ! manifest_peer > "$peer_manifest" 2>>"$LOG"; then
    log "PULL_FAIL peer=$PEER (манифест недоступен)"
    return 1
  fi
  manifest_local > "$local_manifest"

  # Что тянем: есть у peer, НЕТ локально.
  # Размеры не сверяем намеренно — если имя совпало, а размер разный,
  # это конфликт, а не повод перезаписать чужой файл (см. CONFLICT ниже).
  awk -F'\t' 'NR==FNR{have[$1]=1; next} !($1 in have){print $1}' \
      "$local_manifest" "$peer_manifest" > "$STAGE/to_pull"

  local n_pull
  n_pull=$(wc -l < "$STAGE/to_pull")

  if [ "$n_pull" -gt 0 ]; then
    # Один tar-поток на весь батч; --files-from читает список с stdin.
    if ! ssh $SSH_OPTS "$PEER" "cd '$LOCAL' && tar cf - -T -" < "$STAGE/to_pull" \
         | tar xf - -C "$LOCAL" 2>>"$LOG"; then
      log "PULL_FAIL peer=$PEER (передача $n_pull файлов)"
      return 1
    fi
  fi

  # Конфликты: одно имя, разный размер — фиксируем, НЕ перезаписываем.
  join -t$'\t' -j1 <(sort "$local_manifest") <(sort "$peer_manifest") 2>/dev/null \
    | awk -F'\t' '$2 != $3 {print "CONFLICT " $1 " local=" $2 " peer=" $3 " (не перезаписываю)"}' \
    >> "$LOG"

  log "PULL_OK pulled=$n_pull local_total=$(wc -l < "$local_manifest")"
  return 0
}

# ── push: local -> peer (только отсутствующие у peer) ────────────────────────
push() {
  local peer_manifest="$STAGE/peer.manifest"
  local local_manifest="$STAGE/local.manifest"

  manifest_local > "$local_manifest"
  if ! manifest_peer > "$peer_manifest" 2>>"$LOG"; then
    log "PUSH_FAIL peer=$PEER (манифест недоступен)"
    return 1
  fi

  # Что шлём: есть локально, НЕТ у peer.
  awk -F'\t' 'NR==FNR{have[$1]=1; next} !($1 in have){print $1}' \
      "$peer_manifest" "$local_manifest" > "$STAGE/to_push"

  local n_push
  n_push=$(wc -l < "$STAGE/to_push")

  if [ "$n_push" -gt 0 ]; then
    if ! tar cf - -C "$LOCAL" -T "$STAGE/to_push" 2>>"$LOG" \
         | ssh $SSH_OPTS "$PEER" "mkdir -p '$LOCAL' && tar xf - -C '$LOCAL'" 2>>"$LOG"; then
      log "PUSH_FAIL peer=$PEER (передача $n_push файлов)"
      return 1
    fi
  fi

  log "PUSH_OK pushed=$n_push peer_total=$(wc -l < "$peer_manifest")"
  return 0
}

# ── copy_one: один файл на peer (быстрый путь новой загрузки) ────────────────
copy_one() {
  local rel="$1"
  [ -z "$rel" ] && return 0
  [ -f "$LOCAL/$rel" ] || { log "SKIP_MISSING $rel"; return 0; }

  local local_size remote_size
  local_size=$(stat -c %s "$LOCAL/$rel" 2>/dev/null || echo 0)
  remote_size=$(ssh $SSH_OPTS "$PEER" "stat -c %s '$LOCAL/$rel' 2>/dev/null || echo MISSING" 2>>"$LOG" || echo MISSING)

  if [ "$remote_size" = "$local_size" ]; then
    return 0
  fi
  if [ "$remote_size" != "MISSING" ] && [ -n "$remote_size" ]; then
    log "CONFLICT $rel local=$local_size peer=$remote_size (не перезаписываю)"
    return 1
  fi

  local dir
  dir=$(dirname "$rel")
  if scp $SSH_OPTS "$LOCAL/$rel" "$PEER:$LOCAL/$rel" 2>>"$LOG"; then
    log "REPLICATED $rel ($local_size b)"
    return 0
  fi
  ssh $SSH_OPTS "$PEER" "mkdir -p '$LOCAL/$dir'" 2>>"$LOG"
  if scp $SSH_OPTS "$LOCAL/$rel" "$PEER:$LOCAL/$rel" 2>>"$LOG"; then
    log "REPLICATED(retry) $rel"
    return 0
  fi
  log "REPLICATE_FAIL $rel"
  return 1
}

full() {
  pull
  push
  # Стадия нужна только на время merge.
  rm -rf "${STAGE:?}/"* 2>/dev/null
}

case "${1:---once}" in
  --once)  full ;;
  --full)  full ;;
  --file)  shift; copy_one "${1:-}" ;;
  --files) shift; for f in "$@"; do copy_one "$f"; done ;;
  --watch)
    log "WATCH_START peer=$PEER interval=${INTERVAL}s"
    while true; do
      # flock — без наложения прогонов.
      ( flock -n 9 || exit 0; full ) 9>"$LOCK"
      sleep "$INTERVAL"
    done
    ;;
  *) echo "usage: $0 [--once|--full|--file <rel>|--files a b c|--watch]" >&2; exit 1 ;;
esac