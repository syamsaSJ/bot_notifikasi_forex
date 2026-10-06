import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import config from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { initBot, sendMessage, sendPhoto, sendBatchPhotos, getBot } from './bot/telegram.js';
import { getHighImpactNews, clearCache } from './scraper/forexFactory.js';
import { getInvestingNews, formatInvestingSummary } from './scraper/investing.js';
import { analyzeSignal } from './engine/signalEngine.js';
import { formatDailySummary, escapeMarkdown } from './formatter/messageFormatter.js';
import { generateSignalCardImage } from './formatter/imageGenerator.js';
import { startScheduler, getNextRun } from './scheduler/cronJob.js';

const log = createLogger('Main');

let latestNewsCache = [];

function startWebServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.static('public'));

  app.get('/api/news', async (req, res) => {
    try {
      const events = await getHighImpactNews();
      if (events && events.length > 0) {
        latestNewsCache = events.map(e => ({ ...e, signal: analyzeSignal(e) }));
        return res.json({ events: latestNewsCache });
      }
      return res.json({ events: latestNewsCache || [] });
    } catch (err) {
      log.error('Error in /api/news:', err.message);
      res.status(500).json({ error: err.message, events: [] });
    }
  });

  app.get('/api/investing', async (req, res) => {
    try {
      const news = await getInvestingNews();
      res.json({ news });
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
 * Tugas utama: scrape → analyze → generate image card → send.
 * Dijalankan setiap jam oleh cron scheduler.
 */
async function mainTask() {
  log.info('=== Memulai pengecekan berita ===');

  try {
    // 1. Ambil berita high & medium impact USD
    const events = await getHighImpactNews();

    if (events.length === 0) {
      log.info('Tidak ada berita high/medium impact USD saat ini');
      return;
    }

    log.info(`Ditemukan ${events.length} berita USD`);

    // 2. Proses setiap event
    for (const event of events) {
      // Buat unique key untuk menghindari duplikat
      const eventKey = `${event.date}-${event.event}-${event.actual || 'pending'}`;

      // Skip jika sudah pernah dikirim dengan data yang sama
      if (sentNotifications.has(eventKey)) {
        log.debug(`Skip (sudah dikirim): ${event.event}`);
        continue;
      }

      // 3. Analisis sinyal
      const signal = analyzeSignal(event);
      log.info(`${event.event}: ${signal.signal} (${signal.reason})`);

      // 4. Generate Gambar CardNotif
      const imageBuffer = await generateSignalCardImage(event, signal);

      // 5. Kirim Gambar via Telegram Bot
      await sendPhoto(imageBuffer);
      log.info(`Notifikasi gambar terkirim untuk: ${event.event}`);

      // Track sebagai sudah dikirim
      sentNotifications.add(eventKey);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (err) {
    log.error('Error pada mainTask:', err.message);
  }

  log.info('=== Pengecekan selesai ===\n');
}

/**
 * Setup command handler untuk Telegram Bot.
 */
function setupBotCommands() {
  const bot = getBot();
  if (!bot) return;

  // /start - Welcome message
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcome = `🤖 *Bot XAU/USD Signal Aktif\\!*

Saya akan mengirimkan notifikasi berita ekonomi USD dalam bentuk *Gambar Card Elegan* (mirip tampilan app) beserta rekomendasi sinyal XAU/USD\\.

*Perintah tersedia:*
/check \\- Cek berita sekarang (mengirimkan Gambar Card)
/today \\- Jadwal berita hari ini
/investing \\- Berita \\& Indikator dari Investing\\.com
/status \\- Status bot
/help \\- Bantuan

_Notifikasi otomatis dikirim setiap jam \\(Senin\\-Jumat, 07:00\\-23:00 WIB\\)_`;

    await sendMessage(welcome, chatId.toString());
  });

  // /check - Manual trigger cek berita
  bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Sedang membuat gambar card berita\\.\\.\\._', chatId.toString());
    clearCache();

    try {
      const events = await getHighImpactNews();

      if (events.length === 0) {
        await sendMessage('✅ Tidak ada berita high/medium impact USD saat ini\\.', chatId.toString());
        return;
      }

      for (const event of events) {
        const signal = analyzeSignal(event);
        const imageBuffer = await generateSignalCardImage(event, signal);
        await sendPhoto(imageBuffer, '', chatId.toString());
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      await sendMessage(`❌ Error: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  });

  // /today - Jadwal berita hari ini
  bot.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Mengambil jadwal hari ini\\.\\.\\._', chatId.toString());

    try {
      const events = await getHighImpactNews();
      const summary = formatDailySummary(events);
      await sendMessage(summary, chatId.toString());
    } catch (err) {
      await sendMessage(`❌ Error: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  });

  // /status - Status bot
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const now = new Date().toLocaleString('id-ID', { timeZone: config.TIMEZONE });

    const statusMsg = `🤖 *STATUS BOT*
━━━━━━━━━━━━━━━━━━

✅ *Status:* Online
⏰ *Waktu Server:* ${escapeMarkdown(now)}
⏱️ *Uptime:* ${hours}h ${minutes}m
📊 *Notifikasi Terkirim:* ${sentNotifications.size}
📅 *Next Check:* ${escapeMarkdown(getNextRun())}
🔧 *Mode:* ${escapeMarkdown(config.NODE_ENV)}

━━━━━━━━━━━━━━━━━━`;

    await sendMessage(statusMsg, chatId.toString());
  });

  // /investing - Update berita & indikator dari Investing.com
  bot.onText(/\/investing/, async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Mengambil berita \\& indikator dari Investing\\.com\\.\\.\\._', chatId.toString());

    try {
      const news = await getInvestingNews();
      const summary = formatInvestingSummary(news);
      await sendMessage(summary, chatId.toString());
    } catch (err) {
      await sendMessage(`❌ Error: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  });

  // /help - Bantuan
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMsg = `📖 *BANTUAN BOT XAU/USD*
━━━━━━━━━━━━━━━━━━

*Perintah:*
/check \\- Cek berita high\\-impact sekarang
/today \\- Lihat jadwal berita hari ini
/investing \\- Update berita \\& pasar Investing\\.com
/status \\- Cek status bot \\& uptime
/help \\- Tampilkan bantuan ini

*Cara Kerja:*
1\\. Bot mengambil data dari Forex Factory \\& Investing\\.com
2\\. Filter berita high\\-impact USD
3\\. Bandingkan Actual vs Forecast
4\\. Kirim sinyal BUY/SELL XAU/USD

*Jadwal Otomatis:*
Setiap jam, Senin\\-Jumat, 07:00\\-23:00 WIB

━━━━━━━━━━━━━━━━━━
⚠️ _Bukan financial advice\\. Gunakan sebagai referensi tambahan\\._`;

    await sendMessage(helpMsg, chatId.toString());
  });

  log.info('Bot commands registered: /start, /check, /today, /investing, /status, /help');
}

/**
 * Main: bootstrap semua modul.
 */
async function main() {
  log.info('====================================');
  log.info('  Bot XAU/USD Signal - Starting...');
  log.info('====================================');

  // 1. Start Web Dashboard Server
  startWebServer();

  // Validasi env vars
  const isPlaceholderToken = !config.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN.includes('your_') || config.TELEGRAM_BOT_TOKEN.includes('here');
  if (isPlaceholderToken) {
    log.warn('⚠️ TELEGRAM_BOT_TOKEN belum di-set di file .env (masih default/placeholder)');
    log.warn('   Web Dashboard tetap berjalan lancar di http://localhost:3000');
  } else {
    // 2. Init Telegram Bot jika token valid
    try {
      initBot();
      setupBotCommands();
      
      // Jalankan mainTask di background
      mainTask().catch(err => log.error('Main task error:', err.message));
      startScheduler(mainTask);
    } catch (err) {
      log.error('Gagal init Telegram Bot:', err.message);
    }
  }

  log.info('🌐 Web Dashboard siap diakses di: http://localhost:3000');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log.info('Menerima SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('Menerima SIGTERM, shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err.message);
  log.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason);
});

// Start!
main().catch(err => {
  log.error('Fatal error:', err.message);
  process.exit(1);
});

