// alerts.ts — Telegram alerts (serverless)
// Zone transitions, large CPI moves, critical overrides.
// State (previous zone/cpi) stored in KV.

import type { CPIResult, SignalResult } from "./types";
import { getSignalState, setSignalState } from "./store";
import {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_MAX_RETRIES,
  TELEGRAM_RETRY_DELAY,
  CPI_CHANGE_ALERT,
} from "./config";

async function sendTelegram(
  message: string,
  parseMode = "HTML"
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[ALERT] No Telegram credentials \u2014 skipping");
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (let attempt = 1; attempt <= TELEGRAM_MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: parseMode,
        }),
      });

      if (resp.ok) return true;

      const errorText = await resp.text().catch(() => "");
      console.log(
        `[ALERT] Telegram error ${resp.status} (attempt ${attempt}): ${errorText.slice(0, 200)}`
      );

      // Non-retryable
      if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
        return false;
      }

      // Rate limited
      if (resp.status === 429) {
        try {
          const body = JSON.parse(errorText);
          const wait =
            body?.parameters?.retry_after ?? TELEGRAM_RETRY_DELAY;
          console.log(
            `[ALERT] Rate limited \u2014 waiting ${wait}s`
          );
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        } catch {
          /* fall through */
        }
      }
    } catch (e) {
      console.log(
        `[ALERT] Telegram send failed (attempt ${attempt}): ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (attempt < TELEGRAM_MAX_RETRIES) {
      await new Promise((r) =>
        setTimeout(r, TELEGRAM_RETRY_DELAY * 1000)
      );
    }
  }

  console.log(
    `[ALERT] All ${TELEGRAM_MAX_RETRIES} retries failed`
  );
  return false;
}

export async function processAlerts(
  cpiResult: CPIResult,
  _signals: Record<string, SignalResult>
): Promise<void> {
  const state = await getSignalState();
  const previousZone = state.previous_zone;
  const previousCpi = state.previous_cpi;

  const cpi = cpiResult.cpi;
  const zone = cpiResult.zone;
  const zoneName = zone.name;
  const confidence = cpiResult.total_confidence;

  // 1. INSUFFICIENT DATA warning (once)
  if (cpi === null) {
    if (previousZone !== "INSUFFICIENT_DATA") {
      const confPct = Math.round(confidence * 100);
      await sendTelegram(
        `\u26AB <b>WAR ROOM: INSUFFICIENT DATA</b>\nOnly ${confPct}% of signal weight has real data.\nCPI cannot be computed reliably.`
      );
      state.previous_zone = "INSUFFICIENT_DATA";
      await setSignalState(state);
    }
    return;
  }

  // 2. Zone transition
  if (previousZone !== null && previousZone !== zoneName) {
    await sendTelegram(
      `${zone.emoji} <b>ZONE SHIFT: ${previousZone} \u2192 ${zoneName}</b>\nCPI: ${cpi} | Confidence: ${Math.round(confidence * 100)}%\nOpen Sensibull and reassess positions.`
    );
  }

  // 3. Large CPI move
  if (previousCpi !== null && cpi !== null) {
    const delta = Math.abs(cpi - previousCpi);
    if (delta >= CPI_CHANGE_ALERT) {
      const direction = cpi > previousCpi ? "\u{1F4C8}" : "\u{1F4C9}";
      const sign = cpi > previousCpi ? "+" : "";
      await sendTelegram(
        `${direction} <b>CPI MOVE: ${previousCpi} \u2192 ${cpi} (${sign}${cpi - previousCpi})</b>\nZone: ${zoneName} | Confidence: ${Math.round(confidence * 100)}%`
      );
    }
  }

  // 4. Override alerts — critical + warning only
  for (const alert of cpiResult.override_alerts) {
    if (
      alert.severity === "critical" ||
      alert.severity === "warning"
    ) {
      const signal = alert.signal.toUpperCase();
      const icon = alert.severity === "critical" ? "\u{1F6A8}" : "\u26A0\uFE0F";
      const label =
        alert.severity === "critical" ? "ALERT" : "WARNING";
      await sendTelegram(
        `${icon} <b>${signal} ${label}</b>\n${alert.interpretation}`
      );
    }
  }

  // Update state
  state.previous_zone = zoneName;
  state.previous_cpi = cpi;
  await setSignalState(state);
}
