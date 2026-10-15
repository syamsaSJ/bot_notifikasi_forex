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
    const sig = item.signal || item.analysis || {};
    const sigType = sig.signal || 'HOLD';
    const sigEmoji = sigType === 'BUY' ? '🟢 BUY' : sigType === 'SELL' ? '🔴 SELL' : '⚪ HOLD';
    const direction = sig.direction || sig.reason || 'Sentimen Fundamental';
    msg += `${index + 1}\\. *[${escapeMarkdown(item.source || 'Market')}]* ${escapeMarkdown(item.title)}\n`;
    msg += `   📊 *Sinyal XAU/USD:* ${sigEmoji} \\| ${escapeMarkdown(direction)}\n`;
    msg += `   ⏰ ${escapeMarkdown(item.timeWIB || 'Hari Ini')}\n\n`;
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━
_Sumber: Investing.com, TradingView & Pasar Forex Realtime_`;

  return msg;
}

/**
 * Format tampilan Limit Saldo Apify & Jadwal Schedule Otomatis untuk Telegram.
 */
export function formatApifyStatusTelegram(statusData) {
  if (!statusData || !statusData.configured) {
    return `⚠️ *APIFY SCHEDULE & SALDO*
━━━━━━━━━━━━━━━━━━━━━━━━
Token Apify belum dikonfigurasi pada file \`.env\`\\.`;
  }

  let msg = `☁️ *APIFY SCHEDULE & LIMIT SALDO*
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. Bagian Limit & Saldo Kredit Apify
  if (statusData.limits) {
    const lim = statusData.limits;
    const isLowBalance = Number(lim.remainingUsd) < 1.0;
    const balanceIcon = isLowBalance ? '🔴' : '🟢';

    msg += `💰 *LIMIT & SALDO KREDIT APIFY*\n`;
    msg += `• *Akun / Plan:* ${escapeMarkdown(lim.username)} \\(${escapeMarkdown(lim.plan)}\\)\n`;
    msg += `• *Terpakai:* \\$${escapeMarkdown(lim.usedUsd)} / \\$${escapeMarkdown(lim.maxUsd)} \\(${escapeMarkdown(String(lim.usagePercent))}%\\)\n`;
    msg += `• *Sisa Saldo:* ${balanceIcon} *\\$${escapeMarkdown(lim.remainingUsd)}*\n`;
    msg += `• *Compute Units:* ${escapeMarkdown(lim.computeUnitsUsed)} CU\n`;
    msg += `• *Periode Kuota:* ${escapeMarkdown(lim.cycleStart)} \\- ${escapeMarkdown(lim.cycleEnd)}\n\n`;
  } else {
    msg += `💰 *LIMIT & SALDO KREDIT APIFY*\n`;
    msg += `_Gagal memuat detail limit saldo \\(${escapeMarkdown(statusData.error || 'Cek koneksi')}\\)_\n\n`;
  }

  // 2. Bagian Daftar Schedule di Cloud Apify
  msg += `🗓️ *JADWAL SCHEDULE APIFY \\(WIB\\)*\n`;
  const schedules = statusData.schedules || [];
  if (schedules.length === 0) {
    msg += `_Belum ada schedule terdaftar di Apify\\. Ketik /syncschedule untuk membuat otomatis\\._\n\n`;
  } else {
    schedules.forEach((sch, idx) => {
      const badge = sch.isEnabled ? '🟢 AKTIF' : '⚪ STANDBY';
      msg += `${idx + 1}\\. *${escapeMarkdown(sch.title)}*\n`;
      msg += `   • Status: *${escapeMarkdown(badge)}* \\| Cron: \`${escapeMarkdown(sch.cronExpression)}\`\n`;
      msg += `   • Next Run: *${escapeMarkdown(sch.nextRunWIB)}*\n`;
      msg += `   • Last Run: ${escapeMarkdown(sch.lastRunWIB)}\n\n`;
    });
  }

  // 3. Bagian Rentang Minggu Ini & Minggu Depan
  if (statusData.twoWeeksRange) {
    msg += `📆 *Rentang Ambil Senin \\(02:00 WIB\\):*\n`;
    msg += `\`${escapeMarkdown(statusData.twoWeeksRange.startDate)}\` s/d \`${escapeMarkdown(statusData.twoWeeksRange.endDate)}\` \\(Minggu Ini & Depan\\)\n\n`;
  }

  // 4. Bagian Jam Rilis Data Hari Ini (Auto Trigger & Data Yang Berubah)
  const rel = statusData.releaseInfo;
  msg += `⏰ *JADWAL AUTO\\-AMBIL RILIS HARI INI \\(${escapeMarkdown(rel?.todayDateWIB || '-')}\\)*\n`;
  if (!rel || !rel.slots || rel.slots.length === 0) {
    msg += `✅ _Tidak ada jadwal rilis data USD ber\\-jam spesifik hari ini\\._\n`;
  } else {
    rel.slots.forEach((slot, i) => {
      const badge = slot.statusBadge || (slot.allReleased ? '✅ Sudah Rilis' : '⏳ Menunggu Rilis');
      msg += `${i + 1}\\. *Jam Rilis ${escapeMarkdown(slot.releaseTimeWIB)}* ➜ Trigger Apify: *${escapeMarkdown(slot.triggerTimeWIB)}*\n`;
      msg += `   • Status: *${escapeMarkdown(badge)}*\n`;

      slot.events.forEach(e => {
        const hasActual = e.actual && e.actual !== '-';
        const actLabel = hasActual ? `Actual: *${escapeMarkdown(e.actual)}*` : `Actual: \`-\``;
        const foreLabel = e.forecast && e.forecast !== '-' ? `Forecast: ${escapeMarkdown(e.forecast)}` : `Forecast: \`-\``;
        const prevLabel = e.previous && e.previous !== '-' ? `Prev: ${escapeMarkdown(e.previous)}` : '';
        const metricsStr = [actLabel, foreLabel, prevLabel].filter(Boolean).join(' \\| ');

        msg += `   • Data: *${escapeMarkdown(e.event)}*\n`;
        msg += `     📊 ${metricsStr}\n`;
        if (hasActual) {
          msg += `     🎯 Sinyal: *${escapeMarkdown(e.signal)}*\n`;
        } else {
          msg += `     🔄 *Yang Berubah:* ${escapeMarkdown(e.dataChangeDesc || 'Nilai ACTUAL & Sinyal XAU/USD')}\n`;
        }
      });
      msg += '\n';
    });
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━
_Ketik /syncschedule untuk memperbarui jadwal Apify_`;

  return msg;
}

export { formatLogsTelegram };

export function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

