#!/bin/bash
# watchdog.sh  -  runs Telegraf, and stops it (Docker then starts the container again) when the board says it is
# online but no board data has reached Telegraf for WATCHDOG_STALL_S seconds. Telegraf has been seen to stay off
# MQTT after the broker was recreated, and then nothing reached the database.
# Telegraf notes what arrives in two small files (outputs.file in telegraf.conf): the board's lines, its status.
STALL_S=${WATCHDOG_STALL_S:-180}
BOARD=/tmp/heartbeat-board.out STATUS=/tmp/heartbeat-status.out
rm -f "$BOARD" "$STATUS"
/entrypoint.sh telegraf &
pid=$!
trap 'kill -TERM $pid 2>/dev/null; wait $pid; exit 0' TERM INT
sleep 60
while kill -0 $pid 2>/dev/null; do
  sleep 30 & wait $!
  status=$(tail -c 400 "$STATUS" 2>/dev/null | grep -o 'value="[a-z]*"' | tail -1)
  last=$(stat -c %Y "$BOARD" 2>/dev/null || echo 0)
  if [ "$status" = 'value="online"' ] && [ $(( $(date +%s) - last )) -gt "$STALL_S" ]; then
    echo "watchdog: the board is online but no board data for over ${STALL_S} s: restarting Telegraf"
    kill -TERM $pid; sleep 10; kill -KILL $pid 2>/dev/null   # a Telegraf that hangs doesn't stop on TERM
    exit 1
  fi
done
wait $pid
