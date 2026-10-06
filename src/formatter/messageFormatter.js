import { createLogger } from '../utils/logger.js';

const log = createLogger('Formatter');

/**
 * Format impact tag (MEDIUM / HIGH).
 */
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
  const isBuy = signal.signal === 'BUY';
  const isSell = signal.signal === 'SELL';

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
  if (events.length === 0) {
    return `📅 *JADWAL HIGH & MEDIUM IMPACT HARI INI*
━━━━━━━━━━━━━━━━━━━━━━━━

✅ Tidak ada berita high\\/medium impact USD hari ini\\.

_Market kemungkinan bergerak tenang tanpa lonjakan volatilitas tinggi\\._`;
  }

  let message = `📅 *JADWAL BERITA EKONOMI HARI INI*
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  events.forEach((event, index) => {
    const statusEmoji = event.actual && event.actual !== '-' ? '✅' : '⏰';
    const impactBadge = getImpactBadge(event.impact);
    message += `${index + 1}\\. ${statusEmoji} *${escapeMarkdown(event.event)}*\n`;
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
 * Escape karakter khusus untuk Telegram MarkdownV2.
 */
export function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

