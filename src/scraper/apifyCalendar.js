import { ApifyClient } from 'apify-client';
import axios from 'axios';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { parseEconomicValue, formatWIBTime, parseToDateObj, normalizeCalendarTitleKey } from './parser.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';
import { saveUnifiedFeedToSupabase } from '../services/supabaseService.js';
import { analyzeSignal } from '../engine/signalEngine.js';

const log = createLogger('ApifyCalendarScraper');

let cache = {
  data: null,
  timestamp: 0,
};

// Cooldown anti pemborosan kuota Apify (minimal 5 menit antar live run)
let lastLiveRunTimestamp = 0;
const LIVE_RUN_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Cek apakah API Token Apify terkonfigurasi.
 */
export function isApifyConfigured() {
  return Boolean(
    config.APIFY_TOKEN &&
    !config.APIFY_TOKEN.includes('your_') &&
    config.APIFY_TOKEN.trim().length > 0
  );
}

/**
 * Format item mentah dari Apify Actor silentflow/forexfactory-scraper ke format standar bot & Supabase.
 */
export function formatApifyItem(item, idx = 0) {
  const title = item.title || item.fullTitle || item.event || 'Economic Event';
  const rawDate = item.datetime || item.date_utc || item.dateISO || (item.date ? `${item.date}T${item.time && item.time !== 'All Day' ? item.time : '00:00'}:00Z` : new Date().toISOString());
  const dateObj = parseToDateObj(rawDate);
  const wibInfo = formatWIBTime(dateObj);
  const currency = (item.currency || item.countryCode || item.country || 'USD').toUpperCase();
  const impactRaw = (item.impact || item.impactLabel || 'medium').toLowerCase();
  const impact = impactRaw.includes('high') ? 'high' : impactRaw.includes('medium') ? 'medium' : 'low';

  const cleanTitle = normalizeCalendarTitleKey(title) || title.toLowerCase().replace(/[^a-z0-9]/g, '');
  // ID deterministik per event untuk cegah duplikasi di database Supabase
  const eventId = `cal_${wibInfo.dateStr}_${currency}_${cleanTitle}`;

  const actualStr = item.actual !== undefined && item.actual !== null && String(item.actual).trim() !== '' ? String(item.actual).trim() : '-';
  const forecastStr = item.forecast !== undefined && item.forecast !== null && String(item.forecast).trim() !== '' ? String(item.forecast).trim() : '-';
  const previousStr = item.previous !== undefined && item.previous !== null && String(item.previous).trim() !== '' ? String(item.previous).trim() : '-';

  const isAllDayExplicit = Boolean(item.isAllDay || item.time === 'All Day' || item.time === 'All-Day' || item.time === 'Tentative');
  const isAllDay = isAllDayExplicit || (!item.datetime && !item.date_utc && (!item.time || item.time === 'All Day' || item.time === 'All-Day' || item.time === 'Tentative'));

  const evtObj = {
    id: String(eventId),
    itemType: 'calendar',
    source: 'Apify (Forex Factory)',
    event: title,
    title: title,
    date: wibInfo.dateStr,
    time: isAllDay ? '-' : wibInfo.timeWIBStr,
    timeWIB: isAllDay ? `${wibInfo.displayWIB.split('•')[0].trim()} • -` : wibInfo.displayWIB,
    timestamp: wibInfo.timestamp,
    currency: currency,
    impact: impact,
    actual: actualStr,
    forecast: forecastStr,
    previous: previousStr,
    actualValue: item.actualValue !== undefined && item.actualValue !== null ? item.actualValue : parseEconomicValue(actualStr),
    forecastValue: item.forecastValue !== undefined && item.forecastValue !== null ? item.forecastValue : parseEconomicValue(forecastStr),
    previousValue: item.previousValue !== undefined && item.previousValue !== null ? item.previousValue : parseEconomicValue(previousStr),
    url: item.url || 'https://www.forexfactory.com/calendar',
  };

  const signal = analyzeSignal(evtObj);
  evtObj.signal = signal;
  evtObj.analysis = {
    signal: signal.signal,
    direction: signal.direction,
    impactText: signal.predictionText,
  };

  return evtObj;
}

/**
 * Hitung rentang tanggal (Senin minggu ini s.d. Minggu minggu depan = 14 hari)
 * Khusus untuk scrape awal minggu / hari Senin.
 */
export function getThisAndNextWeekDateRange() {
  const now = new Date();
  const dateStrWIB = now.toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE || 'Asia/Jakarta' });
  const [y, m, d] = dateStrWIB.split('-').map(Number);

  const todayUtc = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = todayUtc.getUTCDay(); // 0 = Sun, 1 = Mon, ...

  const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  const mondayUtc = new Date(todayUtc);
  mondayUtc.setUTCDate(todayUtc.getUTCDate() + diffToMonday);

  const sundayNextWeekUtc = new Date(mondayUtc);
  sundayNextWeekUtc.setUTCDate(mondayUtc.getUTCDate() + 13);

  const startDate = mondayUtc.toISOString().split('T')[0];
  const endDate = sundayNextWeekUtc.toISOString().split('T')[0];

  return { startDate, endDate };
}

/**
 * Helper untuk fetch dataset Apify:
 * - Jika forceLiveRun === false: Selalu coba ambil dataset dari run terakhir ($0 Cost, hemat kredit).
 * - Jika forceLiveRun === true: Eksekusi Live Actor Run Apify.
 */
async function fetchActorDataset(actorId, input, forceLiveRun = false) {
  const token = config.APIFY_TOKEN;
  if (!token || token.includes('your_')) return [];

  const normalizedActorId = actorId.replace('/', '~');

  // 1. STRATEGI HEMAT SALDO ($0 COST): Ambil dataset dari run terakhir jika bukan live run
  if (!forceLiveRun) {
    try {
      const lastRunUrl = `https://api.apify.com/v2/actors/${normalizedActorId}/runs/last/dataset/items?token=${token}&status=SUCCEEDED`;
      const res = await axios.get(lastRunUrl, { timeout: 10000 });

      if (res.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
        log.info(`✅ Apify Last Run Dataset ($0 Cost) [${actorId}] Berhasil! (${res.data.length} events)`);
        return res.data;
      }
    } catch (err) {
      log.debug(`Last run dataset fallback info [${actorId}]: ${err.message}`);
    }
  }

  // 2. STRATEGI LIVE ACTOR RUN via Apify SDK (Hanya dipanggil saat jadwal Senin / refresh kalender eksplisit)
  try {
    log.info(`🌐 [APIFY LIVE RUN] Menjalankan Actor [${actorId}]...`);
    const client = new ApifyClient({ token });
    const run = await client.actor(actorId).call(input);

    if (run && run.defaultDatasetId) {
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      if (Array.isArray(items) && items.length > 0) {
        log.info(`✅ ApifyClient SDK [${actorId}] Berhasil! (${items.length} events)`);
        lastLiveRunTimestamp = Date.now();
        return items;
      }
    }
  } catch (sdkErr) {
    log.warn(`ApifyClient SDK error [${actorId}]: ${sdkErr.message}, mencoba REST API sync endpoint...`);
  }

  // 3. REST API Sync Endpoint Fallback
  try {
    const syncUrl = `https://api.apify.com/v2/actors/${normalizedActorId}/run-sync-get-dataset-items?token=${token}&maxItems=500`;
    const res = await axios.post(syncUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    });

    if ((res.status === 200 || res.status === 201) && Array.isArray(res.data) && res.data.length > 0) {
      log.info(`✅ Apify REST Sync [${actorId}] Berhasil! (${res.data.length} events)`);
      lastLiveRunTimestamp = Date.now();
      return res.data;
    }
  } catch (restErr) {
    log.warn(`Apify REST Sync error [${actorId}]: ${restErr.message}`);
  }

  // 4. Fallback ke last run dataset jika live run gagal
  try {
    const lastRunUrl = `https://api.apify.com/v2/actors/${normalizedActorId}/runs/last/dataset/items?token=${token}&status=SUCCEEDED`;
    const res = await axios.get(lastRunUrl, { timeout: 10000 });
    if (res.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
      return res.data;
    }
  } catch (e) {}

  return [];
}

/**
 * Deduplikasi dan penggabungan item kalender dengan memprioritaskan nilai actual rilis.
 */
function deduplicateCalendarItems(formattedItems) {
  const mergedMap = new Map();
  formattedItems.forEach(item => {
    const titleKey = normalizeCalendarTitleKey(item.event || item.title);
    const key = `${item.date}_${item.currency || 'USD'}_${titleKey}`;

    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    } else {
      const existing = mergedMap.get(key);
      if (item.actual && item.actual !== '-' && (!existing.actual || existing.actual === '-')) {
        existing.actual = item.actual;
        existing.actualValue = item.actualValue;
        existing.signal = item.signal;
        existing.analysis = item.analysis;
      }
      if (item.forecast && item.forecast !== '-' && (!existing.forecast || existing.forecast === '-')) {
        existing.forecast = item.forecast;
        existing.forecastValue = item.forecastValue;
      }
      if (item.previous && item.previous !== '-' && (!existing.previous || existing.previous === '-')) {
        existing.previous = item.previous;
        existing.previousValue = item.previousValue;
      }
    }
  });

  return Array.from(mergedMap.values());
}

/**
 * SYNC KHUSUS APIFY:
 * 1. Awal Minggu / Senin: scope = 'two_weeks' (Minggu ini & Next week)
 * 2. Refresh Minggu Ini: scope = 'this_week' (Hanya minggu ini untuk update nilai actual/forecast)
 * 
 * Melindungi dari pemborosan kuota Apify dengan cooldown 5 menit.
 */
export async function syncApifyCalendar(options = {}) {
  const { scope = 'this_week', force = false } = options;
  const now = Date.now();

  if (!isApifyConfigured()) {
    log.warn('⚠️ Apify API token belum di-set di file .env');
    return cache.data || [];
  }

  // Cooldown check agar tidak boros limit Apify jika dipanggil bertubi-tubi
  if (!force && (now - lastLiveRunTimestamp) < LIVE_RUN_COOLDOWN_MS && cache.data && cache.data.length > 0) {
    const sisaDetik = Math.round((LIVE_RUN_COOLDOWN_MS - (now - lastLiveRunTimestamp)) / 1000);
    log.info(`⏳ [APIFY COOLDOWN] Live scrape baru saja dijalankan. Menggunakan data tersimpan (sisa cooldown: ${sisaDetik}s).`);
    return cache.data;
  }

  const actorId = config.APIFY_ACTOR_ID || 'silentflow/forexfactory-scraper';
  let input = {};

  if (scope === 'two_weeks' || scope === 'weekly') {
    const { startDate, endDate } = getThisAndNextWeekDateRange();
    log.info(`🌐 [APIFY SYNC AWAL MINGGU] Mengambil data This Week & Next Week: ${startDate} s/d ${endDate}`);
    input = {
      currencies: ['USD'],
      dateRange: 'custom',
      startDate,
      endDate,
      timeZone: 'UTC',
      maxItems: 400,
    };
  } else {
    log.info(`🌐 [APIFY REFRESH MINGGU INI] Mengambil data rilis minggu ini (this_week)...`);
    input = {
      currencies: ['USD'],
      dateRange: 'this_week',
      timeZone: 'UTC',
      maxItems: 250,
    };
  }

  const rawItems = await fetchActorDataset(actorId, input, true);
  const formattedItems = rawItems.map((item, idx) => formatApifyItem(item, idx));

  if (formattedItems.length === 0) {
    logScrapeResult('ApifyCalendar', false, 0, `Gagal mengambil data dari actor ${actorId}`);
    return cache.data || [];
  }

  const finalEvents = deduplicateCalendarItems(formattedItems);
  log.info(`✅ Apify Sync Berhasil! Diperoleh ${finalEvents.length} event kalender.`);
  logScrapeResult('ApifyCalendar', true, finalEvents.length);

  // Simpan / upsert langsung ke Database Supabase
  await saveUnifiedFeedToSupabase(finalEvents).catch(e => log.warn(`Gagal save Apify events ke Supabase: ${e.message}`));

  cache.data = finalEvents;
  cache.timestamp = now;
  return finalEvents;
}

/**
 * Fetch calendar events untuk kebutuhan umum bot / feed (GRATIS, 0 BIAYA).
 * - Tidak memicu Live Actor Run kecuali jika forceLiveRun = true.
 * - Mengutamakan in-memory cache atau Last Run Dataset.
 */
export async function fetchApifyCalendar(options = {}) {
  const { forceLiveRun = false, scope = 'this_week' } = options;
  const now = Date.now();

  // Jika live run secara spesifik diminta
  if (forceLiveRun) {
    return await syncApifyCalendar({ scope, force: true });
  }

  // Gunakan cache jika masih valid
  if (cache.data && cache.data.length > 0 && (now - cache.timestamp) < config.APIFY_CACHE_TTL_MS) {
    return cache.data;
  }

  if (!isApifyConfigured()) {
    return cache.data || [];
  }

  const actorId = config.APIFY_ACTOR_ID || 'silentflow/forexfactory-scraper';
  const input = {
    currencies: ['USD'],
    dateRange: 'this_week',
    timeZone: 'UTC',
    maxItems: 250,
  };

  // Hanya ambil last-run dataset ($0 Cost) tanpa memicu Actor Run baru
  const rawItems = await fetchActorDataset(actorId, input, false).catch(() => []);
  if (rawItems.length > 0) {
    const formatted = rawItems.map((item, idx) => formatApifyItem(item, idx));
    const deduped = deduplicateCalendarItems(formatted);
    cache.data = deduped;
    cache.timestamp = now;
    return deduped;
  }

  return cache.data || [];
}

export function clearApifyCache() {
  cache = { data: null, timestamp: 0 };
}
