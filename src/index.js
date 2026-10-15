import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import config from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { initBot, sendMessage, sendPhoto, getBot } from './bot/telegram.js';
import { getUnifiedFeed } from './scraper/unifiedFeed.js';
import { clearCache } from './scraper/forexFactory.js';
import { analyzeSignal } from './engine/signalEngine.js';
import { formatMessage, formatDailySummary, formatWeeklySummary, formatHeadlineDigest, formatLogsTelegram, formatApifyStatusTelegram, escapeMarkdown } from './formatter/messageFormatter.js';
import { generateSignalCardImage } from './formatter/imageGenerator.js';
import { startScheduler, getNextRun } from './scheduler/cronJob.js';
import { getScrapeLogs, getSourceHealth } from './utils/scrapeLogger.js';
import { initBrowser, closeBrowser } from './scraper/puppeteerScraper.js';
import {
  getFeedFromSupabase,
  isSupabaseConfigured,
  cleanLegacyDuplicateCalendarEntries,
  hasNextWeekCalendarInSupabase,
  hasThisWeekCalendarInSupabase,
  addOrUpdateSubscriber,
  unsubscribeSubscriber,
  getActiveSubscribers,
  getSubscriberCount,
} from './services/supabaseService.js';
import {
  syncApifyCalendar,
  isApifyConfigured,
  syncApifyCloudSchedules,
  getApifyStatusAndSchedules,
  checkAndRunReleaseTimeSync,
} from './scraper/apifyCalendar.js';

const log = createLogger('Main');

const sentNotifications = new Set();
let isFirstStartupRun = true;
let latestNewsCache = [];
let lastWeeklyApifySyncKey = '';
let lastDailyScheduleSyncDate = '';

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

function getCurrentWeekKey() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: config.TIMEZONE }));
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${weekNo}`;
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

  // Unified Feed Endpoint (Kalender Supabase + Live Free Headlines, $0 Cost, TIDAK memicu Apify live run)
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

      // Ambil feed berita (Free headlines live + cached calendar dari Supabase, syncCalendar = false)
      const range = req.query.range || 'this_week';
      const items = await getUnifiedFeed(forceRefresh, range, { syncCalendar: false });
      latestNewsCache = items;
      return res.json({ events: items, total: items.length, source: 'live' });
    } catch (err) {
      log.error('Error in /api/news:', err.message);
      res.status(500).json({ error: err.message, events: [] });
    }
  });

  // Explicit Apify Calendar Sync Endpoint (Awal Minggu: 'two_weeks', Refresh: 'this_week')
  app.all('/api/calendar/sync', express.json(), async (req, res) => {
    try {
      const scope = req.query.scope || req.body?.scope || 'this_week';
      const force = req.query.force === 'true' || req.body?.force === true;
      log.info(`📅 Request sinkronisasi kalender Apify diterima (scope: ${scope}, force: ${force})`);

      const events = await syncApifyCalendar({ scope, force });
      return res.json({
        success: true,
        message: `Sinkronisasi Kalender Apify (${scope}) berhasil`,
        itemCount: events.length,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      log.error('Error in /api/calendar/sync:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Apify Schedule & Limit Saldo Endpoint
  app.get('/api/apify/status', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true';
      if ((!latestNewsCache || latestNewsCache.length === 0) && isSupabaseConfigured()) {
        const dbItems = await getFeedFromSupabase().catch(() => []);
        if (dbItems && dbItems.length > 0) latestNewsCache = dbItems;
      }
      const status = await getApifyStatusAndSchedules(latestNewsCache, forceRefresh);
      return res.json(status);
    } catch (err) {
      log.error('Error in /api/apify/status:', err.message);
      return res.status(500).json({ configured: false, error: err.message });
    }
  });

  // Sync / Update Schedules di Apify Console
  app.post('/api/apify/sync-schedules', express.json(), async (req, res) => {
    try {
      if ((!latestNewsCache || latestNewsCache.length === 0) && isSupabaseConfigured()) {
        const dbItems = await getFeedFromSupabase().catch(() => []);
        if (dbItems && dbItems.length > 0) latestNewsCache = dbItems;
      }
      const syncRes = await syncApifyCloudSchedules(latestNewsCache);
      const status = await getApifyStatusAndSchedules(latestNewsCache, true);
      return res.json({
        success: syncRes.success,
        error: syncRes.error || null,
        status,
      });
    } catch (err) {
      log.error('Error in /api/apify/sync-schedules:', err.message);
      return res.status(500).json({ success: false, error: err.message });
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

  // Active Telegram Subscribers List API
  app.get('/api/subscribers', async (req, res) => {
    try {
      const subs = isSupabaseConfigured() ? await getActiveSubscribers() : [];
      res.json({ total: subs.length, subscribers: subs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook / External Trigger Endpoint (Dipanggil saat Schedule Apify selesai jalan)
  app.all(['/api/webhook/apify', '/api/trigger-scrape'], express.json(), async (req, res) => {
    log.info('🔔 External Webhook diterima! Memproses sync Supabase...');
    try {
      const scope = req.query.scope || req.body?.scope || 'this_week';
      const events = await syncApifyCalendar({ scope, force: true });
      return res.json({
        success: true,
        message: 'Sync Supabase Berhasil',
        scope,
        itemCount: events.length,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      log.error('Error in Webhook:', err.message);
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
 * 1. Otomatis jalankan scrape Apify This Week + Next Week setiap Hari Senin jam >= 02:00 WIB.
 * 2. Otomatis cek apakah hari ini & jam sekarang ada jadwal rilis data USD (jika ada & actual masih '-', otomatis ambil data Apify).
 * 3. Cek headline berita pasar gratis (TradingView, ForexLive, RSS) setiap 1 menit tanpa boros limit Apify.
 * 4. Deteksi event/headline baru -> broadcast 0-delay SSE -> kirim notifikasi Telegram.
 */
async function mainTask() {
  log.debug('=== Pengecekan realtime berita terpadu ===');

  try {
    const nowWib = new Date(new Date().toLocaleString('en-US', { timeZone: config.TIMEZONE }));
    const dayOfWeekWib = nowWib.getDay(); // 1 = Monday
    const hourWib = nowWib.getHours();
    const todayDateWib = new Date().toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE });
    const currentWeekKey = getCurrentWeekKey();

    // 1. JADWAL OTOMATIS AWAL MINGGU (SETIAP HARI SENIN JAM >= 02:00 WIB): Scrape Minggu Ini & Next Week via Apify
    if (dayOfWeekWib === 1 && hourWib >= 2 && lastWeeklyApifySyncKey !== currentWeekKey && isApifyConfigured()) {
      const alreadyInSupabase = await hasNextWeekCalendarInSupabase();
      if (alreadyInSupabase) {
        lastWeeklyApifySyncKey = currentWeekKey;
        log.info(`ℹ️ [SENIN 02:00 WIB CHECK] Jadwal kalender minggu depan sudah lengkap di Supabase. Melewati scrape ulang Apify ($0 Cost).`);
      } else {
        log.info(`🗓️ [JADWAL SENIN 02:00 WIB] Menjalankan scrape Apify untuk Minggu Ini & Next Week (${currentWeekKey})...`);
        try {
          await syncApifyCalendar({ scope: 'two_weeks', force: true });
          lastWeeklyApifySyncKey = currentWeekKey;
          log.info(`✅ [JADWAL SENIN 02:00 WIB] Kalender 2 minggu berhasil di-update ke Supabase!`);
        } catch (apifyErr) {
          log.error(`Gagal scrape Apify jadwal Senin: ${apifyErr.message}`);
        }
      }
    }

    // 2. Polling headline berita realtime gratis (TradingView, ForexLive, RSS) + Kalender dari Supabase
    const items = await getUnifiedFeed(false, 'this_week', { syncCalendar: false });

    if (!items || items.length === 0) {
      return;
    }

    latestNewsCache = items;

    // 3. INITIAL STARTUP GUARD (Render Redeploy / Server Restart):
    // Pada saat restart/deploy pertama kali, murni muat histori ke memori dan JANGAN picu scrape/notifikasi baru!
    if (isFirstStartupRun) {
      log.info(`📌 Initial startup: Memuat ${items.length} item histori ke memori (notifikasi spam & auto-scrape dinonaktifkan).`);
      for (const item of items) {
        const uniqueKey = `${item.date}-${item.title || item.event}-${item.actual || item.pubDate || 'v1'}`;
        sentNotifications.add(uniqueKey);
      }
      isFirstStartupRun = false;
      lastDailyScheduleSyncDate = todayDateWib;
      return;
    }

    // 4. SINKRONISASI SCHEDULE HARIAN DI APIFY SETIAP PERGANTIAN HARI WIB ($0 Cost, hanya update cron jadwal)
    if (isApifyConfigured() && lastDailyScheduleSyncDate !== todayDateWib && latestNewsCache.length > 0) {
      lastDailyScheduleSyncDate = todayDateWib;
      syncApifyCloudSchedules(latestNewsCache).catch(e => log.debug(`Daily schedule sync error: ${e.message}`));
    }

    // 5. DETEKSI JAM RILIS DATA HARI INI: Hanya aktif saat siklus normal (bukan startup) tepat di jam rilis berita USD!
    if (isApifyConfigured() && latestNewsCache.length > 0) {
      const releasedEvents = await checkAndRunReleaseTimeSync(latestNewsCache);
      if (releasedEvents && releasedEvents.length > 0) {
        log.info(`⚡ [AUTO RELEASE SYNC] Data rilis terbaru berhasil diambil (${releasedEvents.length} items).`);
      }
    }

    // Ambil item terbaru yang belum dikirim
    for (const item of items) {
      const uniqueKey = `${item.date}-${item.title || item.event}-${item.actual || item.pubDate || 'v1'}`;

      if (sentNotifications.has(uniqueKey)) {
        continue;
      }

      // Broadcast Instan KE Dashboard Web (0 Delay SSE)
      broadcastSSE('NEWS_RELEASE', { item, timestamp: Date.now() });

      // 1. Jika item berupa Kalender Ekonomi
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
      // 2. Jika item berupa Headline Berita Relevan (Investing / TradingView / ForexLive)
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

  // /start - Registrasi & Langganan Notifikasi Otomatis
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const user = msg.from || {};

    if (isSupabaseConfigured()) {
      await addOrUpdateSubscriber({
        chatId,
        username: user.username || '',
        firstName: user.first_name || '',
        lastName: user.last_name || '',
      });
    }

    const userName = user.first_name ? ` ${escapeMarkdown(user.first_name)}` : '';
    const welcome = `🤖 *Bot XAU/USD Signal Unified Realtime*

Halo${userName}! 👋
✅ *Anda telah terdaftar sebagai penerima notifikasi otomatis!*
Setiap kali ada rilis berita high\\-impact atau sinyal fundamental BUY / SELL XAU/USD \\(Gold\\), Anda akan otomatis menerima notifikasi langsung di chat ini\\.

*Daftar Perintah:*
/check \\- Cek berita & sinyal terbaru sekarang
/today \\- Jadwal kalender & berita hari ini (WIB)
/weekly \\- Jadwal kalender ekonomi minggu ini (WIB)
/status \\- Status bot & jumlah subscriber aktif
/stop \\- Berhenti berlangganan notifikasi otomatis
/help \\- Bantuan & daftar perintah`;

    await sendMessage(welcome, chatId);
  });

  // /stop & /unsubscribe - Berhenti menerima notifikasi otomatis
  bot.onText(/\/(stop|unsubscribe)/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (isSupabaseConfigured()) {
      await unsubscribeSubscriber(chatId);
      await sendMessage('🔕 *Anda telah berhenti berlangganan notifikasi otomatis XAU/USD\\.*\\n\\nAnda tidak akan menerima broadcast notifikasi lagi\\. Ketik /start atau /subscribe kapan saja untuk mengaktifkan kembali\\.', chatId);
    } else {
      await sendMessage('⚠️ Database belum aktif, hubungi administrator.', chatId);
    }
  });

  // /subscribe - Aktifkan kembali notifikasi
  bot.onText(/\/subscribe/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const user = msg.from || {};
    if (isSupabaseConfigured()) {
      await addOrUpdateSubscriber({
        chatId,
        username: user.username || '',
        firstName: user.first_name || '',
        lastName: user.last_name || '',
      });
      await sendMessage('✅ *Notifikasi XAU/USD berhasil diaktifkan kembali!*\\nAnda akan menerima sinyal & berita rilis secara otomatis\\.', chatId);
    } else {
      await sendMessage('⚠️ Database belum aktif, hubungi administrator.', chatId);
    }
  });

  // /subscribers - Daftar subscriber aktif (khusus admin / info)
  bot.onText(/\/subscribers/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isSupabaseConfigured()) {
      await sendMessage('⚠️ Database Supabase belum terkonfigurasi\\.', chatId);
      return;
    }

    try {
      const subs = await getActiveSubscribers();
      if (!subs || subs.length === 0) {
        await sendMessage('ℹ️ Belum ada subscriber aktif di database\\.', chatId);
        return;
      }

      const listText = subs.map((s, idx) => {
        const u = s.username ? `@${escapeMarkdown(s.username)}` : escapeMarkdown(s.first_name || 'User');
        return `${idx + 1}\\. ${u} \\(\`${s.chat_id}\`\\)`;
      }).join('\\n');

      await sendMessage(`👥 *Daftar Subscriber Aktif (${subs.length} orang):*\\n\\n${listText}`, chatId);
    } catch (err) {
      await sendMessage(`❌ Gagal mengambil daftar subscriber: ${escapeMarkdown(err.message)}`, chatId);
    }
  });

  // /check - Manual check
  bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Sedang mengambil berita terpadu realtime\\.\\.\\._', chatId.toString());
    clearCache();

    try {
      const items = await getUnifiedFeed(true, 'this_week', { syncCalendar: false });

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
      const items = await getUnifiedFeed(false, 'this_week', { syncCalendar: false });
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
      const items = await getUnifiedFeed(false, 'this_week', { syncCalendar: false });
      const calItems = items.filter(i => i.itemType === 'calendar' || i.event);

      if (!calItems || calItems.length === 0) {
        await sendMessage('✅ Tidak ada event kalender ekonomi minggu ini\\.', chatId.toString());
        return;
      }

      const fullSummary = formatWeeklySummary(calItems);

      if (fullSummary.length <= 3800) {
        await sendMessage(fullSummary, chatId.toString());
      } else {
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

  // /apify, /jadwal, /schedule - Lihat Jadwal Schedule Apify & Limit Saldo Apify
  const handleApifyScheduleCommand = async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Mengambil informasi Schedule & Limit Saldo Apify\\.\\.\\._', chatId.toString());

    try {
      if (!latestNewsCache || latestNewsCache.length === 0) {
        latestNewsCache = await getUnifiedFeed(false, 'this_week', { syncCalendar: false });
      }
      const statusData = await getApifyStatusAndSchedules(latestNewsCache, true);
      const textMsg = formatApifyStatusTelegram(statusData);
      await sendMessage(textMsg, chatId.toString());
    } catch (err) {
      await sendMessage(`❌ Error cek Apify: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  };

  bot.onText(/\/apify/, handleApifyScheduleCommand);
  bot.onText(/\/jadwal/, handleApifyScheduleCommand);
  bot.onText(/\/schedule/, handleApifyScheduleCommand);

  // /syncschedule - Sinkronisasi jadwal Schedule ke Cloud Apify (Senin 02:00 WIB + Jam Rilis Hari Ini)
  bot.onText(/\/syncschedule/, async (msg) => {
    const chatId = msg.chat.id;
    await sendMessage('⏳ _Menyinkronkan Schedule Senin 02:00 WIB & Jam Rilis Harian ke Cloud Apify\\.\\.\\._', chatId.toString());

    try {
      if (!latestNewsCache || latestNewsCache.length === 0) {
        latestNewsCache = await getUnifiedFeed(false, 'this_week', { syncCalendar: false });
      }
      const res = await syncApifyCloudSchedules(latestNewsCache);
      if (!res.success) {
        await sendMessage(`❌ Gagal update schedule Apify: ${escapeMarkdown(res.error || 'Unknown error')}`, chatId.toString());
        return;
      }
      const statusData = await getApifyStatusAndSchedules(latestNewsCache, true);
      const textMsg = formatApifyStatusTelegram(statusData);
      await sendMessage(textMsg, chatId.toString());
    } catch (err) {
      await sendMessage(`❌ Error sync schedule: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  });

  // /synccalendar - Sinkronisasi manual kalender via Apify
  bot.onText(/\/synccalendar(?:\s+(this_week|two_weeks))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const scope = match[1] || 'this_week';
    await sendMessage(`⏳ _Memulai sinkronisasi Kalender Ekonomi via Apify (${scope === 'two_weeks' ? 'Minggu Ini & Next Week' : 'Minggu Ini'})..._`, chatId.toString());

    try {
      const events = await syncApifyCalendar({ scope, force: true });
      await sendMessage(`✅ *Sinkronisasi Apify Berhasil!*\nTotal: ${events.length} event kalender tersimpan rapi di database & jadwal rilis diperbarui.`, chatId.toString());
    } catch (err) {
      await sendMessage(`❌ Gagal sync Apify: ${escapeMarkdown(err.message)}`, chatId.toString());
    }
  });

  // /logs - Log error & status scraping
  bot.onText(/\/logs/, async (msg) => {
    const chatId = msg.chat.id;
    const logsMsg = formatLogsTelegram();
    await sendMessage(logsMsg, chatId.toString());
  });

  // /status - Server status + Ringkasan Saldo & Schedule Apify
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const now = new Date().toLocaleString('id-ID', { timeZone: config.TIMEZONE });

    const apifyStat = await getApifyStatusAndSchedules(latestNewsCache, false).catch(() => null);
    let saldoLine = 'Belum dikonfigurasi';
    if (apifyStat?.limits) {
      saldoLine = `\\$${escapeMarkdown(apifyStat.limits.usedUsd)} / \\$${escapeMarkdown(apifyStat.limits.maxUsd)} \\(Sisa: \\$${escapeMarkdown(apifyStat.limits.remainingUsd)}\\)`;
    }

    let subscriberLine = '1 (Local .env)';
    if (isSupabaseConfigured()) {
      const subCount = await getSubscriberCount();
      subscriberLine = `${subCount} orang (Supabase Database)`;
    }

    const statusMsg = `🤖 *STATUS BOT & SCHEDULER*
━━━━━━━━━━━━━━━━━━

✅ *Status Bot:* Online & Realtime
⏰ *Waktu WIB:* ${escapeMarkdown(now)}
⏱️ *Uptime:* ${hours}h ${minutes}m
👥 *Subscriber Aktif:* ${escapeMarkdown(subscriberLine)}
📊 *Notifikasi Terkirim:* ${sentNotifications.size}
⚡ *Interval Polling:* Setiap 1 Menit \\(Free Headlines & SSE\\)
🗓️ *Schedule Mingguan:* Setiap Senin 02:00 WIB \\(Minggu Ini & Depan\\)
⏰ *Schedule Rilis:* Otomatis Saat Jam Rilis Berita \\(WIB\\)
💰 *Saldo Kredit Apify:* ${saldoLine}
📅 *Next Check:* ${escapeMarkdown(getNextRun())}

_Ketik /subscribers untuk melihat daftar penerima notifikasi_
━━━━━━━━━━━━━━━━━━`;

    await sendMessage(statusMsg, chatId.toString());
  });

  // /help
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMsg = `📖 *BANTUAN BOT XAU/USD REALTIME*
━━━━━━━━━━━━━━━━━━

*Perintah Utama:*
/start \\- Daftar & aktifkan notifikasi otomatis
/check \\- Cek berita terpadu & sinyal sekarang
/today \\- Lihat jadwal berita hari ini (WIB)
/weekly \\- Lihat jadwal kalender ekonomi minggu ini (WIB)
/status \\- Cek status bot, jadwal & saldo Apify
/stop \\- Berhenti berlangganan notifikasi otomatis
/subscribe \\- Aktifkan kembali notifikasi otomatis
/subscribers \\- Lihat daftar penerima notifikasi

*Perintah Admin & Advanced:*
/apify \\- Lihat jadwal Schedule Apify & Limit Saldo Apify
/jadwal \\- Lihat jadwal rilis data & Schedule Apify
/syncschedule \\- Update otomatis jadwal Schedule di Apify Console
/synccalendar \\- Sync manual kalender Apify (/synccalendar this_week atau two_weeks)
/logs \\- Cek status kesehatan scraper & log error
/help \\- Tampilkan bantuan ini`;

    await sendMessage(helpMsg, chatId.toString());
  });

  log.info('Bot commands registered: /start, /stop, /subscribe, /subscribers, /check, /today, /weekly, /apify, /jadwal, /syncschedule, /synccalendar, /logs, /status, /help');
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

  // 1. Bersihkan seluruh data duplikat legacy (ff_json_ dan ff_xml_) dari database Supabase
  if (isSupabaseConfigured()) {
    log.info('🧹 Memeriksa dan membersihkan duplikat legacy di database Supabase...');
    await cleanLegacyDuplicateCalendarEntries().catch(e => log.warn(`Legacy cleanup error: ${e.message}`));

    // 2. Cek apakah database Supabase masih kosong kalender minggu ini
    const hasThisWeek = await hasThisWeekCalendarInSupabase().catch(() => true);
    if (!hasThisWeek && isApifyConfigured()) {
      log.info('📌 Kalender minggu ini belum ada di Supabase. Menjalankan sinkronisasi awal Apify...');
      await syncApifyCalendar({ scope: 'two_weeks' }).catch(e => log.warn(`Initial Apify sync error: ${e.message}`));
    }

    // 3. Muat data kalender dari Supabase & sinkronkan Schedule Apify (Senin 02:00 WIB + Jam Rilis Hari Ini)
    const initialDbItems = await getFeedFromSupabase().catch(() => []);
    if (initialDbItems && initialDbItems.length > 0) {
      latestNewsCache = initialDbItems;
    }
  }

  if (isApifyConfigured()) {
    log.info('🗓️ Mengonfigurasi Schedule Otomatis di Cloud Apify (Senin 02:00 WIB & Jam Rilis Harian)...');
    syncApifyCloudSchedules(latestNewsCache).catch(e => log.warn(`Initial Apify Schedule sync warning: ${e.message}`));
  }

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
