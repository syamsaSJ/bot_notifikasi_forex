import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import config from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { initBot, sendMessage, sendPhoto, getBot } from './bot/telegram.js';
import { getUnifiedFeed } from './scraper/unifiedFeed.js';
import { clearCache } from './scraper/forexFactory.js';
import { analyzeSignal } from './engine/signalEngine.js';
import { formatMessage, formatDailySummary, formatWeeklySummary, formatHeadlineDigest, formatLogsTelegram, escapeMarkdown } from './formatter/messageFormatter.js';
import { generateSignalCardImage } from './formatter/imageGenerator.js';
import { startScheduler, getNextRun } from './scheduler/cronJob.js';
import { getScrapeLogs, getSourceHealth } from './utils/scrapeLogger.js';
import { initBrowser, closeBrowser } from './scraper/puppeteerScraper.js';
import { getFeedFromSupabase, isSupabaseConfigured } from './services/supabaseService.js';

const log = createLogger('Main');

const sentNotifications = new Set();
let isFirstStartupRun = true;
let latestNewsCache = [];

// SSE (Server-Sent Events) clients untuk 0-delay real-time push ke Web Dashboard
const sseClients = new Set();

function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  });
}

function startWebServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.static('public'));

  // SSE Stream Endpoint (Zero Delay Broadcast)
  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    log.info(`⚡ Client terhubung ke Realtime SSE Stream (Total: ${sseClients.size} aktif)`);

    req.on('close', () => {
      sseClients.delete(res);
      log.info(`Client terputus dari Realtime SSE Stream (Sisa: ${sseClients.size} aktif)`);
    });
  });

  // Unified Feed Endpoint (Gabungan ForexFactory, Apify & Investing.com)
  app.get('/api/news', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';

      // 1. Coba ambil data dari Database Supabase jika terkonfigurasi (kecuali jika paksa refresh)
      if (!forceRefresh && isSupabaseConfigured()) {
        const dbItems = await getFeedFromSupabase();
        if (dbItems && dbItems.length > 0) {
          latestNewsCache = dbItems;
          return res.json({ events: dbItems, total: dbItems.length, source: 'supabase' });
        }
      }

      const range = req.query.range || (forceRefresh ? 'realtime' : 'realtime');
      const items = await getUnifiedFeed(forceRefresh, range);
      latestNewsCache = items;
      return res.json({ events: items, total: items.length, source: 'live' });
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

  // Webhook / External Trigger Endpoint (Apify Schedule & External Cron Pemicu Render)
  app.all(['/api/webhook/apify', '/api/trigger-scrape'], express.json(), async (req, res) => {
    log.info('🔔 External Webhook / Apify Trigger diterima! Memproses scrape realtime & sync Supabase...');
    try {
      const range = req.query.range || req.body?.range || 'realtime';
      const items = await getUnifiedFeed(true, range);
      return res.json({
        success: true,
        message: 'Trigger & Sync Supabase Berhasil',
        range,
        itemCount: items.length,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      log.error('Error in Webhook /api/trigger-scrape:', err.message);
      return res.status(500).json({ success: false, error: err.message });
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
 * Mengambil unified feed -> mendeteksi event/headline baru -> broadcast 0-delay SSE -> kirim notifikasi Telegram.
 */
async function mainTask() {
  log.debug('=== Pengecekan realtime berita terpadu ===');

  try {
    // Otomatis tentukan range: Jika hari Senin WIB, gunakan range 'weekly' (This Week + Next Week)
    const nowWibStr = new Date().toLocaleString('en-US', { timeZone: config.TIMEZONE });
    const dayOfWeekWib = new Date(nowWibStr).getDay(); // 1 = Monday
    const range = dayOfWeekWib === 1 ? 'weekly' : 'realtime';

    const items = await getUnifiedFeed(false, range);

    if (!items || items.length === 0) {
      return;
    }

    // Pada startup pertama kali, tandai seluruh data historical sebagai terproses agar tidak spam notifikasi
    if (isFirstStartupRun) {
      log.info(`📌 Initial startup: Memuat ${items.length} item histori dari Supabase ke memori (notifikasi spam dinonaktifkan).`);
      for (const item of items) {
        const uniqueKey = `${item.date}-${item.title || item.event}-${item.actual || item.pubDate || 'v1'}`;
        sentNotifications.add(uniqueKey);
      }
      isFirstStartupRun = false;
      return;
    }

    // Ambil item terbaru yang belum dikirim
    for (const item of items) {
      const uniqueKey = `${item.date}-${item.title || item.event}-${item.actual || item.pubDate || 'v1'}`;

      if (sentNotifications.has(uniqueKey)) {
        continue;
      }

      // Broadcast Instan KE Dashboard Web (0 Delay SSE)
      broadcastSSE('NEWS_RELEASE', { item, timestamp: Date.now() });

      // 1. Jika item berupa Kalender Ekonomi (Forex Factory)
      if (item.itemType === 'calendar') {
        const signal = item.signal || analyzeSignal(item);
        log.info(`⚡ [ZERO DELAY BROADCAST] ${item.event}: ${signal.signal} (${signal.reason})`);

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
          log.info(`⚡ [ZERO DELAY BROADCAST NEWS] ${item.title}: Sinyal ${sig.signal}`);
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
/weekly \\- Jadwal kalender ekonomi minggu ini (WIB)
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

  // /weekly & /week - Jadwal kalender ekonomi minggu ini
  const handleWeeklyCommand = async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Mengambil jadwal kalender ekonomi minggu ini (WIB)\\.\\.\\._', chatId.toString());

    try {
      const items = await getUnifiedFeed(true, 'weekly');
      const calItems = items.filter(i => i.itemType === 'calendar' || i.event);

      if (!calItems || calItems.length === 0) {
        await sendMessage('✅ Tidak ada event kalender ekonomi minggu ini\\.', chatId.toString());
        return;
      }

      const fullSummary = formatWeeklySummary(calItems);

      if (fullSummary.length <= 3800) {
        await sendMessage(fullSummary, chatId.toString());
      } else {
        // Split berdasarkan bagian tanggal agar tidak terpotong
        const parts = fullSummary.split(/(?=🗓️ \*)/g);
        let currentChunk = '';
        for (const part of parts) {
          if ((currentChunk + part).length > 3800) {
            if (currentChunk.trim()) await sendMessage(currentChunk, chatId.toString());
            currentChunk = part;
          } else {
            currentChunk += part;
          }
        }
        if (currentChunk.trim()) {
          await sendMessage(currentChunk, chatId.toString());
        }
      }
    } catch (err) {
      await sendMessage(`❌ Error: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  };

  bot.onText(/\/weekly/, handleWeeklyCommand);
  bot.onText(/\/week/, handleWeeklyCommand);

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
/weekly \\- Lihat jadwal kalender ekonomi minggu ini (WIB)
/logs \\- Cek status kesehatan scraper & log error
/status \\- Cek status bot & scheduler
/help \\- Tampilkan bantuan ini

*Sistem Unified Realtime:*
• Menggabungkan Forex Factory, Investing.com, dan Headline Pasar secara realtime.
• Konversi waktu otomatis ke WIB (+7).
• Notifikasi dikirim instan jika ada rilis atau berita baru.`;

    await sendMessage(helpMsg, chatId.toString());
  });

  log.info('Bot commands registered: /start, /check, /today, /weekly, /logs, /status, /help');
}

/**
 * Bootstrap Application.
 */
async function main() {
  log.info('=============================================');
  log.info('  Bot XAU/USD Signal Unified Realtime Start  ');
  log.info('=============================================');

  await initBrowser(); // Inisialisasi Puppeteer di awal agar selalu siap sedia
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

process.on('SIGINT', async () => { log.info('Shutting down...'); await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { log.info('Shutting down...'); await closeBrowser(); process.exit(0); });
process.on('uncaughtException', (err) => { log.error('Uncaught exception:', err.message); });
process.on('unhandledRejection', (reason) => { log.error('Unhandled rejection:', reason); });

main().catch(err => {
  log.error('Fatal error:', err.message);
  process.exit(1);
});
