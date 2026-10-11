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
  const rawTimeStr = event.timeWIB || event.time || '-';
  const timeStr = rawTimeStr.replace(/All Day|All-Day|Tentative|TBD/gi, '-');

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
 * Format ringkasan mingguan (Weekly Economic Calendar) yang dikelompokkan berdasarkan tanggal.
 */
export function formatWeeklySummary(events) {
  if (!events || events.length === 0) {
    return `📅 *JADWAL BERITA EKONOMI MINGGU INI (WIB)*
━━━━━━━━━━━━━━━━━━━━━━━━

✅ Tidak ada berita/event kalender ekonomi USD untuk minggu ini\\.`;
  }

  const calEvents = events.filter(i => i.itemType === 'calendar' || i.source === 'Forex Factory' || i.event);

  if (calEvents.length === 0) {
    return `📅 *JADWAL BERITA EKONOMI MINGGU INI (WIB)*
━━━━━━━━━━━━━━━━━━━━━━━━

✅ Tidak ada event kalender ekonomi USD untuk minggu ini\\.`;
  }

  // Kelompokkan event berdasarkan tanggal WIB
  const groupedByDate = {};
  calEvents.forEach(event => {
    const d = event.date || 'TBD';
    if (!groupedByDate[d]) groupedByDate[d] = [];
    groupedByDate[d].push(event);
  });

  const sortedDates = Object.keys(groupedByDate).sort();

  let message = `📅 *JADWAL BERITA EKONOMI MINGGU INI (WIB)*
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  sortedDates.forEach(dateStr => {
    const dayEvents = groupedByDate[dateStr];
    const sampleTimeWIB = dayEvents[0]?.timeWIB || '';
    const dateLabel = sampleTimeWIB.includes('•') ? sampleTimeWIB.split('•')[0].trim() : dateStr;

    message += `🗓️ *${escapeMarkdown(dateLabel)}*\n`;

    dayEvents.forEach((event, idx) => {
      const statusEmoji = event.actual && event.actual !== '-' ? '✅' : '⏰';
      const impactBadge = getImpactBadge(event.impact);
      const curr = (event.currency || 'USD').toUpperCase();
      let timeOnly = (event.timeWIB && event.timeWIB.includes('•'))
        ? event.timeWIB.split('•')[1].trim()
        : (event.time || '-');
      timeOnly = timeOnly.replace(/All Day|All-Day|Tentative|TBD/gi, '-');

      message += `  ${idx + 1}\\. ${statusEmoji} *[${escapeMarkdown(curr)}]* *${escapeMarkdown(event.event || event.title)}*\n`;
      message += `     📅 ${escapeMarkdown(timeOnly)} • ${escapeMarkdown(impactBadge)}\n`;

      if (event.actual && event.actual !== '-') {
        message += `     📊 Actual: *${escapeMarkdown(event.actual)}* | Forecast: ${escapeMarkdown(event.forecast)} | Prev: ${escapeMarkdown(event.previous)}\n`;
      } else {
        message += `     📊 Forecast: ${escapeMarkdown(event.forecast)} | Prev: ${escapeMarkdown(event.previous)}\n`;
      }
    });

    message += '\n';
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━
_Total: ${calEvents.length} Event Kalender Ekonomi Minggu Ini_`;

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
