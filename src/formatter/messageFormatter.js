import { createLogger } from '../utils/logger.js';
import { formatLogsTelegram } from '../utils/scrapeLogger.js';

const log = createLogger('Formatter');

function getImpactBadge(impactStr) {
  const imp = (impactStr || '').toLowerCase();
  if (imp.includes('high') || imp.includes('red')) return '🔴 HIGH';
  if (imp.includes('medium') || imp.includes('orange')) return '🟠 MEDIUM';
  return '🟡 LOW';
}

/**
 * Format card notifikasi utama (persis layout screenshot client).
 */
export function formatMessage(event, signal) {
  const impactBadge = getImpactBadge(event.impact);
  const timeStr = event.timeWIB || event.time || 'TBD';

  const actualDisp   = event.actual   && event.actual   !== '' ? event.actual   : '-';
  const forecastDisp = event.forecast && event.forecast !== '' ? event.forecast : '-';
  const previousDisp = event.previous && event.previous !== '' ? event.previous : '-';

  const predictionText = signal.predictionText || signal.analysis || 'Tidak ada analisis korelasi.';

  return `*${escapeMarkdown(event.event)}*
${escapeMarkdown(timeStr)} • ${escapeMarkdown(impactBadge)}
━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────┬──────────┬──────────┬──────────┐
│  *SIGNAL*  │  *ACTUAL*  │ *FORECAST* │ *PREVIOS*  │
│   *${escapeMarkdown(signal.signal)}*   │   ${escapeMarkdown(actualDisp)}    │   ${escapeMarkdown(forecastDisp)}   │   ${escapeMarkdown(previousDisp)}   │
└──────────┴──────────┴──────────┴──────────┘

📝 *PREDIKSI*
${escapeMarkdown(predictionText)}
━━━━━━━━━━━━━━━━━━━━━━━━`;
}

/**
 * Format ringkasan harian.
 */
export function formatDailySummary(events) {
  if (!events || events.length === 0) {
    return `📅 *JADWAL BERITA EKONOMI HARI INI*
━━━━━━━━━━━━━━━━━━━━━━━━

✅ Tidak ada berita high/medium impact USD untuk hari ini\\.`;
  }

  let message = `📅 *JADWAL BERITA EKONOMI HARI INI*
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  events.forEach((event, index) => {
    const statusEmoji = event.actual && event.actual !== '-' ? '✅' : '⏰';
    const impactBadge = getImpactBadge(event.impact);
    message += `${index + 1}\\. ${statusEmoji} *${escapeMarkdown(event.event || event.title)}*\n`;
    message += `   📅 ${escapeMarkdown(event.timeWIB || event.time)} • ${escapeMarkdown(impactBadge)}\n`;
    if (event.actual && event.actual !== '-') {
      message += `   📊 Actual: ${escapeMarkdown(event.actual)} | Forecast: ${escapeMarkdown(event.forecast)} | Prev: ${escapeMarkdown(event.previous)}\n`;
    } else {
      message += `   📊 Forecast: ${escapeMarkdown(event.forecast)} | Prev: ${escapeMarkdown(event.previous)}\n`;
    }
    message += '\n';
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━
_Total: ${events.length} berita USD_`;

  return message;
}

/**
 * Format digest headline berita terbaru dengan rekomendasi sinyal.
 */
export function formatHeadlineDigest(newsItems) {
  if (!newsItems || newsItems.length === 0) return null;

  let msg = `📰 *BERITA & ANALISIS SENTIMEN PASAR REALTIME*
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  newsItems.forEach((item, index) => {
    const sigEmoji = item.signal.signal === 'BUY' ? '🟢 BUY' : item.signal.signal === 'SELL' ? '🔴 SELL' : '⚪ HOLD';
    msg += `${index + 1}\\. *[${escapeMarkdown(item.source)}]* ${escapeMarkdown(item.title)}\n`;
    msg += `   📊 *Sinyal XAU/USD:* ${sigEmoji} \\| ${escapeMarkdown(item.signal.direction || 'Sentimen Pasar')}\n`;
    msg += `   ⏰ ${escapeMarkdown(item.timeWIB)}\n\n`;
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━
_Sumber: Investing.com & Pasar Forex Realtime_`;

  return msg;
}

export { formatLogsTelegram };

export function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
