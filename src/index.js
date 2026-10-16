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
import { initBrowser, closeBrowser, fetchForexFactoryCalendarPuppeteer } from './scraper/puppeteerScraper.js';
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
  getTodayReleaseScheduleInfo,
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

  // Explicit Calendar Sync Endpoint (Awal Minggu: 'two_weeks', Refresh: 'this_week')
  // Mendukung mode async non-blocking (&async=true) untuk merespon instan <100ms agar BEBAS dari HTTP 504 Timeout di hosting Render
  app.all('/api/calendar/sync', express.json(), async (req, res) => {
    try {
      const scope = req.query.scope || req.body?.scope || 'two_weeks';
      const force = req.query.force === 'true' || req.body?.force === true;
      const provider = req.query.provider || req.body?.provider || 'puppeteer';
      const isAsync = req.query.async === 'true' || req.body?.async === true;
      log.info(`📅 Request sinkronisasi kalender diterima (scope: ${scope}, provider: ${provider}, force: ${force}, async: ${isAsync})`);

      const executeSync = async () => {
        let events = [];
        if (provider === 'apify' && isApifyConfigured()) {
          events = await syncApifyCalendar({ scope, force });
        } else {
          events = await fetchForexFactoryCalendarPuppeteer({ scope, force });
        }

        // Broadcast event SSE ke semua web client yang sedang aktif
        broadcastSSE('CALENDAR_SYNCED', {
          scope,
          provider,
          itemCount: events.length,
          timestamp: new Date().toISOString()
        });

        return events;
      };

      // Jika mode async aktif (misal dari UI Web atau webhook Render): langsung respon 200 OK dalam 0.05 detik
      if (isAsync) {
        executeSync().catch((err) => log.error('Background calendar sync error:', err.message));
        return res.json({
          success: true,
          status: 'processing',
          message: `Sinkronisasi Kalender (${scope}) dimulai di background. Hasil otomatis diperbarui di web via realtime stream.`,
          timestamp: new Date().toISOString()
        });
      }

      const events = await executeSync();

      return res.json({
        success: true,
        message: `Sinkronisasi Kalender (${scope}) berhasil via ${provider}`,
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

  // Webhook / External Trigger Endpoint (Sinkronisasi kalender cepat & $0 cost)
  app.all(['/api/webhook/apify', '/api/trigger-scrape'], express.json(), async (req, res) => {
    log.info('🔔 External Webhook / Trigger Scrape diterima! Memproses kalender...');
    try {
      const scope = req.query.scope || req.body?.scope || 'two_weeks';
      const events = await fetchForexFactoryCalendarPuppeteer({ scope, force: true });
      return res.json({
        success: true,
        message: 'Sync Kalender via Puppeteer Berhasil ($0 Cost)',
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

    // 1. JADWAL OTOMATIS AWAL MINGGU (SETIAP HARI SENIN JAM >= 02:00 WIB): Scrape Minggu Ini & Next Week via Puppeteer ($0 Cost, tanpa limit)
    if (dayOfWeekWib === 1 && hourWib >= 2 && lastWeeklyApifySyncKey !== currentWeekKey) {
      const alreadyInSupabase = await hasNextWeekCalendarInSupabase();
      if (alreadyInSupabase) {
        lastWeeklyApifySyncKey = currentWeekKey;
        log.info(`ℹ️ [SENIN 02:00 WIB CHECK] Jadwal kalender minggu depan sudah lengkap di Supabase. Melewati scrape ulang ($0 Cost).`);
      } else {
        log.info(`🗓️ [JADWAL SENIN 02:00 WIB] Menjalankan scrape Puppeteer Stealth untuk Minggu Ini & Next Week (${currentWeekKey})...`);
        try {
          await fetchForexFactoryCalendarPuppeteer({ scope: 'two_weeks', force: true });
          lastWeeklyApifySyncKey = currentWeekKey;
          log.info(`✅ [JADWAL SENIN 02:00 WIB] Kalender 2 minggu berhasil di-update via Puppeteer ke Supabase ($0 Cost)!`);
        } catch (pupErr) {
          log.error(`Gagal scrape Puppeteer jadwal Senin: ${pupErr.message}`);
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

  // /check - Ambil jadwal rilis sekarang/hari ini dan berita realtime
  bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id.toString();
    await sendMessage('⏳ _Sedang mengambil jadwal kalender hari ini & berita pasar realtime (WIB)\\.\\.\\._', chatId);
    clearCache();

    try {
      const items = await getUnifiedFeed(true, 'this_week', { syncCalendar: false });
      const todayWIBStr = new Date().toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE });

      // 1. Ambil Jadwal Kalender Ekonomi Hari Ini (WIB)
      const todayCalEvents = (items || []).filter(i =>
        (i.itemType === 'calendar' || i.source === 'Forex Factory' || i.event) &&
        (i.date === todayWIBStr || (i.timeWIB && i.timeWIB.includes('Hari Ini')))
      );
      todayCalEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      if (todayCalEvents.length > 0) {
        const todaySummary = formatDailySummary(todayCalEvents);
        await sendMessage(todaySummary, chatId);

        // Highlight event terpenting / yang baru saja rilis hari ini dalam bentuk Card Image
        const primeEvent = todayCalEvents.find(e => e.impact === 'high' || (e.actual && e.actual !== '-')) || todayCalEvents[0];
        if (primeEvent) {
          try {
            const signal = primeEvent.signal || analyzeSignal(primeEvent);
            const imageBuffer = await generateSignalCardImage(primeEvent, signal);
            await sendPhoto(imageBuffer, '', chatId);
          } catch (cardErr) {
            log.warn(`Gagal buat gambar di /check: ${cardErr.message}`);
          }
        }
      } else {
        await sendMessage(`📅 *JADWAL KALENDER EKONOMI HARI INI (${escapeMarkdown(todayWIBStr)})*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n✅ Tidak ada jadwal rilis berita ekonomi USD ber\\-impact tinggi/sedang hari ini \\(Pasar Tenang\\)\\.`, chatId);
      }

      // 2. Ambil Berita Pasar Realtime (TradingView, Investing.com, ForexLive)
      const recentNews = (items || []).filter(i => i.itemType === 'investing').slice(0, 4);
      if (recentNews.length > 0) {
        const digestMsg = formatHeadlineDigest(recentNews);
        if (digestMsg) {
          await sendMessage(digestMsg, chatId);
        }
      } else {
        await sendMessage('ℹ️ Belum ada update headline berita pasar baru dalam 1 jam terakhir\\.', chatId);
      }
    } catch (err) {
      await sendMessage(`❌ Error: ${escapeMarkdown(err.message)}`, chatId);
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

  // /synccalendar - Sinkronisasi manual kalender via Puppeteer Stealth ($0 Cost, tanpa batas limit)
  bot.onText(/\/synccalendar(?:\s+(this_week|two_weeks))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const scope = match[1] || 'two_weeks';
    await sendMessage(`⏳ _Memulai sinkronisasi Kalender Ekonomi via Puppeteer Stealth (${scope === 'two_weeks' ? 'Minggu Ini & Next Week' : 'Minggu Ini'})... ($0 Cost, Tanpa Kuota Limit)_`, chatId.toString());

    try {
      const events = await fetchForexFactoryCalendarPuppeteer({ scope, force: true });
      await sendMessage(`✅ *Sinkronisasi Kalender Berhasil!*\nTotal: ${events.length} event USD untuk Minggu Ini & Minggu Depan tersimpan di database ($0 Cost, kuota Apify hemat & hanya dipakai saat jam rilis).`, chatId.toString());
    } catch (err) {
      await sendMessage(`❌ Gagal sync kalender: ${escapeMarkdown(err.message)}`, chatId.toString());
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

_Ketik /apify atau /jadwal untuk detail lengkap jadwal & saldo Apify_
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

*Perintah Admin & Advanced:*
/apify \\- Lihat jadwal Schedule Apify & Limit Saldo Apify
/jadwal \\- Lihat jadwal rilis data & Schedule Apify
/syncschedule \\- Update otomatis jadwal Schedule di Apify Console
/synccalendar \\- Sync manual kalender Apify (/synccalendar this_week atau two_weeks)
/logs \\- Cek status kesehatan scraper & log error
/help \\- Tampilkan bantuan ini`;

    await sendMessage(helpMsg, chatId.toString());
  });

  log.info('Bot commands registered: /start, /stop, /subscribe, /check, /today, /weekly, /apify, /jadwal, /syncschedule, /synccalendar, /logs, /status, /help');
}

/**
 * Bootstrap Application.
 */
async function main() {
  log.info('=============================================');
  log.info('  Bot XAU/USD Signal Unified Realtime Start  ');
  log.info('=============================================');

  startWebServer();

  // 1. Bersihkan seluruh data duplikat legacy (ff_json_ dan ff_xml_) dari database Supabase
  if (isSupabaseConfigured()) {
    log.info('🧹 Memeriksa dan membersihkan duplikat legacy di database Supabase...');
    await cleanLegacyDuplicateCalendarEntries().catch(e => log.warn(`Legacy cleanup error: ${e.message}`));

    // 2. Muat data kalender dari Supabase: jika sudah ada, Puppeteer dilewati (hanya berjalan Senin 02:00 WIB atau tombol Sync)
    const initialDbItems = await getFeedFromSupabase().catch(() => []);
    if (initialDbItems && initialDbItems.length > 0) {
      latestNewsCache = initialDbItems;
      log.info(`📌 Menggunakan ${initialDbItems.length} data kalender dari Supabase (Puppeteer dilewati saat startup, hemat resource).`);
    } else {
      // Hanya jika Supabase benar-benar kosong (initial setup), lakukan scrape awal via Puppeteer
      log.info('📌 Database Supabase kosong, inisialisasi awal Minggu Ini & Next Week via Puppeteer...');
      await fetchForexFactoryCalendarPuppeteer({ scope: 'two_weeks', force: true }).catch(e => log.warn(`Initial Puppeteer sync error: ${e.message}`));
      const seeded = await getFeedFromSupabase().catch(() => []);
      if (seeded && seeded.length > 0) latestNewsCache = seeded;
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
