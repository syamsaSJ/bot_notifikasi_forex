import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import config from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { initBot, sendMessage, sendPhoto, getBot } from './bot/telegram.js';
import { getUnifiedFeed } from './scraper/unifiedFeed.js';
import { clearCache } from './scraper/forexFactory.js';
import { analyzeSignal } from './engine/signalEngine.js';
import { formatMessage, formatDailySummary, formatHeadlineDigest, formatLogsTelegram, escapeMarkdown } from './formatter/messageFormatter.js';
import { generateSignalCardImage } from './formatter/imageGenerator.js';
import { startScheduler, getNextRun } from './scheduler/cronJob.js';
import { getScrapeLogs, getSourceHealth } from './utils/scrapeLogger.js';

const log = createLogger('Main');

const sentNotifications = new Set();
let latestNewsCache = [];

function startWebServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.static('public'));

  // Unified Feed Endpoint (Gabungan ForexFactory & Investing.com)
  app.get('/api/news', async (req, res) => {
    try {
      const items = await getUnifiedFeed();
      latestNewsCache = items;
      return res.json({ events: items, total: items.length });
    } catch (err) {
      log.error('Error in /api/news:', err.message);
      res.status(500).json({ error: err.message, events: [] });
    }
  });

  // Scraping Health & Logs Endpoint
  app.get('/api/scrape-logs', (req, res) => {
    try {
      const health = getSourceHealth();
      const logs = getScrapeLogs(30);
      res.json({ health, logs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, () => {
    log.info(`🌐 Web Dashboard Server berjalan pada: http://localhost:${PORT}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const fallbackPort = 3001;
      app.listen(fallbackPort, () => {
        log.info(`🌐 Web Dashboard Server berjalan pada: http://localhost:${fallbackPort}`);
      });
    }
  });
}

/**
 * Main Task: Polling realtime 1-menit.
 * Mengambil unified feed -> mendeteksi event/headline baru -> kirim notifikasi Telegram.
 */
async function mainTask() {
  log.debug('=== Pengecekan realtime berita terpadu ===');

  try {
    const items = await getUnifiedFeed();

    if (!items || items.length === 0) {
      return;
    }

    // Ambil item terbaru yang belum dikirim
    for (const item of items) {
      const uniqueKey = `${item.date}-${item.title || item.event}-${item.actual || item.pubDate || 'v1'}`;

      if (sentNotifications.has(uniqueKey)) {
        continue;
      }

      // 1. Jika item berupa Kalender Ekonomi (Forex Factory)
      if (item.itemType === 'calendar') {
        const signal = item.signal || analyzeSignal(item);
        log.info(`[NOTIF CALENDAR] ${item.event}: ${signal.signal} (${signal.reason})`);

        try {
          const imageBuffer = await generateSignalCardImage(item, signal);
          await sendPhoto(imageBuffer);
          log.info(`Card image terkirim untuk: ${item.event}`);
        } catch (imgErr) {
          log.warn(`Gagal kirim gambar untuk ${item.event}, fallback ke teks: ${imgErr.message}`);
          const textMsg = formatMessage(item, signal);
          await sendMessage(textMsg);
        }

        sentNotifications.add(uniqueKey);
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
      // 2. Jika item berupa Headline Berita Relevan (Investing / News)
      else if (item.itemType === 'investing') {
        const sig = item.analysis || {};
        // Auto-kirim hanya jika berita punya sinyal tegas BUY / SELL (High Relevance)
        if (sig.signal === 'BUY' || sig.signal === 'SELL') {
          log.info(`[NOTIF NEWS] ${item.title}: Sinyal ${sig.signal}`);
          const digestText = formatHeadlineDigest([item]);
          if (digestText) {
            await sendMessage(digestText);
            log.info(`Digest headline terkirim untuk: ${item.title}`);
          }
          sentNotifications.add(uniqueKey);
          await new Promise(resolve => setTimeout(resolve, 1200));
        } else {
          // Tandai sebagai sudah diproses agar tidak menumpuk
          sentNotifications.add(uniqueKey);
        }
      }
    }
  } catch (err) {
    log.error('Error pada mainTask:', err.message);
  }
}

/**
 * Register command handlers untuk Telegram Bot.
 */
function setupBotCommands() {
  const bot = getBot();
  if (!bot) return;

  // /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcome = `🤖 *Bot XAU/USD Signal Unified Realtime*

Bot aktif mendeteksi rilis berita ekonomi & headline pasar XAU/USD secara realtime (polling 1-menit) dengan konversi waktu WIB yang presisi.

*Perintah:*
/check \\- Cek berita & sinyal terbaru sekarang
/today \\- Jadwal berita harian WIB
/logs \\- Status & log error scraping
/status \\- Status server bot
/help \\- Bantuan`;

    await sendMessage(welcome, chatId.toString());
  });

  // /check - Manual check
  bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Sedang mengambil berita terpadu realtime\\.\\.\\._', chatId.toString());
    clearCache();

    try {
      const items = await getUnifiedFeed(true);

      if (!items || items.length === 0) {
        await sendMessage('✅ Tidak ada berita/event aktif saat ini\\.', chatId.toString());
        return;
      }

      const topCalEvents = items.filter(i => i.itemType === 'calendar').slice(0, 3);
      for (const event of topCalEvents) {
        const signal = event.signal || analyzeSignal(event);
        try {
          const imageBuffer = await generateSignalCardImage(event, signal);
          await sendPhoto(imageBuffer, '', chatId.toString());
        } catch (imgErr) {
          const textMsg = formatMessage(event, signal);
          await sendMessage(textMsg, chatId.toString());
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const topNews = items.filter(i => i.itemType === 'investing').slice(0, 4);
      if (topNews.length > 0) {
        const digestMsg = formatHeadlineDigest(topNews);
        if (digestMsg) await sendMessage(digestMsg, chatId.toString());
      }
    } catch (err) {
      await sendMessage(`❌ Error: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  });

  // /today - Jadwal hari ini
  bot.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Mengambil jadwal & berita hari ini (WIB)\\.\\.\\._', chatId.toString());

    try {
      const items = await getUnifiedFeed();
      const todayWIBStr = new Date().toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE });
      const todayItems = items.filter(i => i.date === todayWIBStr || (i.timeWIB && i.timeWIB.includes('Hari Ini')));
      const summary = formatDailySummary(todayItems.length > 0 ? todayItems : items.slice(0, 8));
      await sendMessage(summary, chatId.toString());
    } catch (err) {
      await sendMessage(`❌ Error: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  });

  // /logs - Log error & status scraping
  bot.onText(/\/logs/, async (msg) => {
    const chatId = msg.chat.id;
    const logsMsg = formatLogsTelegram();
    await sendMessage(logsMsg, chatId.toString());
  });

  // /status - Server status
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const now = new Date().toLocaleString('id-ID', { timeZone: config.TIMEZONE });

    const statusMsg = `🤖 *STATUS BOT & SCHEDULER*
━━━━━━━━━━━━━━━━━━

✅ *Status Bot:* Online & Realtime
⏰ *Waktu WIB:* ${escapeMarkdown(now)}
⏱️ *Uptime:* ${hours}h ${minutes}m
📊 *Notifikasi Terkirim:* ${sentNotifications.size}
⚡ *Interval Polling:* Setiap 1 Menit
📅 *Next Check:* ${escapeMarkdown(getNextRun())}

━━━━━━━━━━━━━━━━━━`;

    await sendMessage(statusMsg, chatId.toString());
  });

  // /help
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMsg = `📖 *BANTUAN BOT XAU/USD REALTIME*
━━━━━━━━━━━━━━━━━━

*Perintah:*
/check \\- Cek berita terpadu & sinyal sekarang
/today \\- Lihat jadwal berita hari ini (WIB)
/logs \\- Cek status kesehatan scraper & log error
/status \\- Cek status bot & scheduler
/help \\- Tampilkan bantuan ini

*Sistem Unified Realtime:*
• Menggabungkan Forex Factory, Investing.com, dan Headline Pasar secara realtime.
• Konversi waktu otomatis ke WIB (+7).
• Notifikasi dikirim instan jika ada rilis atau berita baru.`;

    await sendMessage(helpMsg, chatId.toString());
  });

  log.info('Bot commands registered: /start, /check, /today, /logs, /status, /help');
}

/**
 * Bootstrap Application.
 */
async function main() {
  log.info('=============================================');
  log.info('  Bot XAU/USD Signal Unified Realtime Start  ');
  log.info('=============================================');

  startWebServer();

  const isPlaceholderToken = !config.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN.includes('your_') || config.TELEGRAM_BOT_TOKEN.includes('here');
  if (isPlaceholderToken) {
    log.warn('⚠️ TELEGRAM_BOT_TOKEN belum di-set di file .env');
    log.warn('   Web Dashboard tetap berjalan di http://localhost:3000');
  } else {
    try {
      initBot();
      setupBotCommands();
      
      mainTask().catch(err => log.error('Main task initial run error:', err.message));
      startScheduler(mainTask);
    } catch (err) {
      log.error('Gagal init Telegram Bot:', err.message);
    }
  }

  log.info('🌐 Web Dashboard siap diakses di: http://localhost:3000');
}

process.on('SIGINT', () => { log.info('Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { log.info('Shutting down...'); process.exit(0); });
process.on('uncaughtException', (err) => { log.error('Uncaught exception:', err.message); });
process.on('unhandledRejection', (reason) => { log.error('Unhandled rejection:', reason); });

main().catch(err => {
  log.error('Fatal error:', err.message);
  process.exit(1);
});
