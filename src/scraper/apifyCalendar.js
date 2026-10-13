import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ApifyClient, ScheduleActions } from 'apify-client';
import axios from 'axios';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { parseEconomicValue, formatWIBTime, parseToDateObj, normalizeCalendarTitleKey } from './parser.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';
import { saveUnifiedFeedToSupabase } from '../services/supabaseService.js';
import { analyzeSignal } from '../engine/signalEngine.js';

const log = createLogger('ApifyCalendarScraper');
const ENV_FILE_PATH = path.resolve(process.cwd(), '.env');

let cache = {
  data: null,
  timestamp: 0,
};

// Cooldown anti pemborosan kuota Apify (minimal 3 menit antar live run)
let lastLiveRunTimestamp = 0;
const LIVE_RUN_COOLDOWN_MS = 3 * 60 * 1000;

// Cache untuk status limit/saldo & schedule Apify agar respons cepat
let apifyStatusCache = {
  data: null,
  timestamp: 0,
};

// Pelacak perubahan file .env & token Apify secara otomatis (Hot-Reload)
let lastEnvMtimeMs = 0;
let lastKnownApifyToken = config.APIFY_TOKEN || '';

// Nama standar Schedule di Apify Console
const SCHEDULE_WEEKLY_NAME = 'forex-monday-2weeks';
const SCHEDULE_RELEASE_NAME = 'forex-daily-release';

// Melacak jam rilis yang sudah di-sync hari ini agar tidak berulang-ulang
const syncedReleaseKeys = new Set();

/**
 * Ambil APIFY_TOKEN aktif dan otomatis deteksi jika file .env diubah (tanpa perlu restart bot).
 * Jika token berubah ke akun baru, otomatis mereset cache saldo & membuat Schedule di akun Apify baru.
 */
export function getActiveApifyToken() {
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      const stat = fs.statSync(ENV_FILE_PATH);
      if (stat.mtimeMs !== lastEnvMtimeMs) {
        lastEnvMtimeMs = stat.mtimeMs;
        const parsed = dotenv.parse(fs.readFileSync(ENV_FILE_PATH, 'utf8'));
        const envToken = (parsed.APIFY_TOKEN || parsed.APIFY_API_TOKEN || '').trim();
        if (envToken) {
          process.env.APIFY_TOKEN = envToken;
          config.APIFY_TOKEN = envToken;
        }
        if (parsed.APIFY_ACTOR_ID) {
          process.env.APIFY_ACTOR_ID = parsed.APIFY_ACTOR_ID.trim();
          config.APIFY_ACTOR_ID = parsed.APIFY_ACTOR_ID.trim();
        }
      }
    }
  } catch (e) {
    // Abaikan jika gagal baca stat .env
  }

  const currentToken = (config.APIFY_TOKEN || process.env.APIFY_TOKEN || '').trim();

  if (currentToken && lastKnownApifyToken && currentToken !== lastKnownApifyToken) {
    log.info('🔄 [APIFY TOKEN DIGANTI] Mendeteksi APIFY_TOKEN baru di .env! Mereset cache & memindahkan Schedule ke akun Apify baru...');
    lastKnownApifyToken = currentToken;
    apifyStatusCache = { data: null, timestamp: 0 };
    lastLiveRunTimestamp = 0;
    // Otomatis buat/update schedule di akun Apify yang baru
    setTimeout(() => {
      syncApifyCloudSchedules(cache.data || []).catch(err =>
        log.warn(`Gagal auto-sync schedule ke token Apify baru: ${err.message}`)
      );
    }, 500);
  } else if (currentToken && !lastKnownApifyToken) {
    lastKnownApifyToken = currentToken;
  }

  return currentToken;
}

/**
 * Cek apakah API Token Apify terkonfigurasi.
 */
export function isApifyConfigured() {
  const token = getActiveApifyToken();
  return Boolean(
    token &&
    !token.includes('your_') &&
    token.length > 0
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
 * Khusus untuk scrape awal minggu / hari Senin jam 02:00 WIB.
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
 * Ekstrak jam & menit WIB dari event kalender hari ini.
 * Mengembalikan daftar jadwal rilis hari ini beserta cron expression H+1 menit setelah rilis.
 */
export function getTodayReleaseScheduleInfo(events = []) {
  const todayWIBStr = new Date().toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE || 'Asia/Jakarta' });
  const nowMs = Date.now();

  const todayEvents = (events || []).filter(e => {
    if (e.itemType && e.itemType !== 'calendar') return false;
    const curr = (e.currency || 'USD').toUpperCase();
    if (curr !== 'USD' && curr !== 'ALL') return false;
    return e.date === todayWIBStr && e.time && e.time !== '-' && !/All Day|Tentative|TBD/i.test(e.time);
  });

  // Sort berdasarkan waktu rilis paling awal ke akhir
  todayEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // Kelompokkan berdasarkan jam:menit WIB
  const slotMap = new Map();
  todayEvents.forEach(evt => {
    // Format evt.time biasanya "19.30 WIB" atau "19:30 WIB"
    const match = String(evt.time || evt.timeWIB || '').match(/(\d{1,2})[:.](\d{2})\s*WIB/i);
    if (!match) return;

    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    if (isNaN(hour) || isNaN(minute)) return;

    // Trigger schedule Apify pada H+1 menit setelah jam rilis agar angka Actual sudah muncul
    let triggerMinute = minute + 1;
    let triggerHour = hour;
    if (triggerMinute >= 60) {
      triggerMinute = triggerMinute - 60;
      triggerHour = (triggerHour + 1) % 24;
    }

    const timeKey = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (!slotMap.has(timeKey)) {
      slotMap.set(timeKey, {
        releaseTimeWIB: `${timeKey} WIB`,
        hour,
        minute,
        triggerHour,
        triggerMinute,
        triggerTimeWIB: `${String(triggerHour).padStart(2, '0')}:${String(triggerMinute).padStart(2, '0')} WIB`,
        cronExpression: `${triggerMinute} ${triggerHour} * * *`,
        timestamp: evt.timestamp,
        events: [],
        allReleased: true,
        isSpeechOnly: true,
      });
    }

    const slot = slotMap.get(timeKey);
    const isSpeechEvent = /speaks|speech|meeting|testimony|statement/i.test(evt.event || evt.title || '') || (!evt.forecast || evt.forecast === '-') && (!evt.previous || evt.previous === '-');
    if (!isSpeechEvent) {
      slot.isSpeechOnly = false;
    }

    slot.events.push({
      id: evt.id,
      event: evt.event || evt.title,
      impact: evt.impact,
      actual: evt.actual || '-',
      forecast: evt.forecast || '-',
      previous: evt.previous || '-',
      signal: evt.signal?.signal || 'HOLD',
      isSpeech: isSpeechEvent,
      dataChangeDesc: isSpeechEvent
        ? 'Pidato Pejabat The Fed (Sentimen Pasar)'
        : 'Nilai ACTUAL (dari "-") & Sinyal XAU/USD (BUY/SELL)',
    });

    // Jika event bukan speech dan actual masih '-', slot dianggap belum rilis
    if (!isSpeechEvent && (!evt.actual || evt.actual === '-')) {
      slot.allReleased = false;
    }
  });

  const slots = Array.from(slotMap.values());

  // Evaluasi status masing-masing slot berdasarkan waktu sekarang
  slots.forEach(slot => {
    const isPassed = nowMs > (slot.timestamp + 15 * 60 * 1000);
    slot.isPassed = isPassed;

    if (slot.allReleased) {
      slot.statusBadge = '✅ Sudah Rilis';
      slot.statusDesc = 'Data Actual sudah terbit dan sinyal telah dianalisis.';
    } else if (isPassed && slot.isSpeechOnly) {
      slot.statusBadge = '✅ Selesai (Pidato Berlangsung)';
      slot.statusDesc = 'Pidato/event The Fed telah berlangsung (tidak ada angka numerik Actual).';
      slot.allReleased = true; // Tandai selesai agar tidak memicu scrape berulang
    } else if (isPassed) {
      slot.statusBadge = '⏱️ Jadwal Lewat';
      slot.statusDesc = 'Jam rilis telah lewat, menunggu angka Actual terisi di Forex Factory.';
    } else {
      slot.statusBadge = '⏳ Menunggu Rilis';
      slot.statusDesc = 'Memantau perubahan kolom ACTUAL & SINYAL XAU/USD (BUY/SELL).';
    }
  });

  // Cari slot yang belum rilis (actual === '-') dan waktunya belum lewat lebih dari 15 menit
  const upcomingSlots = slots.filter(s => !s.allReleased && (nowMs <= s.timestamp + 15 * 60 * 1000));

  // Buat cron expression gabungan untuk slot terdekat / hari ini
  let nextCronExpression = '31 19 * * 1-5'; // Default fallback jika tidak ada rilis
  let hasActiveReleaseToday = false;

  if (upcomingSlots.length > 0) {
    hasActiveReleaseToday = true;
    // Ambil menit dari slot terdekat berikutnya, dan gabungkan semua jam yang memiliki menit trigger yang sama
    const firstSlot = upcomingSlots[0];
    const sameMinuteHours = upcomingSlots
      .filter(s => s.triggerMinute === firstSlot.triggerMinute)
      .map(s => s.triggerHour);
    const uniqueHours = [...new Set(sameMinuteHours)].join(',');
    nextCronExpression = `${firstSlot.triggerMinute} ${uniqueHours} * * *`;
  } else if (slots.length > 0) {
    // Semua slot hari ini sudah punya actual atau sudah lewat
    const firstSlot = slots[0];
    const sameMinuteHours = slots
      .filter(s => s.triggerMinute === firstSlot.triggerMinute)
      .map(s => s.triggerHour);
    const uniqueHours = [...new Set(sameMinuteHours)].join(',');
    nextCronExpression = `${firstSlot.triggerMinute} ${uniqueHours} * * *`;
  }

  return {
    todayDateWIB: todayWIBStr,
    totalEventsToday: todayEvents.length,
    slots,
    upcomingSlots,
    hasActiveReleaseToday,
    nextCronExpression,
  };
}

/**
 * Buat atau Update Schedule di Apify Console secara terprogram menggunakan ApifyClient & ScheduleActions:
 * 1. Schedule Senin Jam 02:00 WIB ("0 2 * * 1") -> Ambil Minggu Ini & Minggu Depan (two_weeks).
 * 2. Schedule Harian Jam Rilis ("forex-daily-release") -> Jalan otomatis tepat H+1 menit saat ada berita rilis hari itu.
 */
export async function syncApifyCloudSchedules(calendarEvents = []) {
  if (!isApifyConfigured()) {
    return { success: false, error: 'APIFY_TOKEN belum dikonfigurasi' };
  }

  try {
    const client = new ApifyClient({ token: config.APIFY_TOKEN });
    const actorName = config.APIFY_ACTOR_ID || 'silentflow/forexfactory-scraper';

    // Dapatkan ID internal Actor agar ScheduleActions.RunActor selalu valid di Apify API
    let resolvedActorId = actorName;
    try {
      const actorInfo = await client.actor(actorName).get();
      if (actorInfo && actorInfo.id) {
        resolvedActorId = actorInfo.id;
      }
    } catch (e) {
      log.debug(`Actor lookup info: ${e.message}`);
    }

    const { items: existingSchedules = [] } = await client.schedules().list();
    const { startDate, endDate } = getThisAndNextWeekDateRange();

    // 1. KONFIGURASI SCHEDULE SENIN JAM 02:00 WIB (Minggu Ini + Minggu Depan)
    const weeklyInput = {
      currencies: ['USD'],
      dateRange: 'custom',
      startDate,
      endDate,
      timeZone: 'UTC',
      maxItems: 400,
    };

    const weeklySchedulePayload = {
      name: SCHEDULE_WEEKLY_NAME,
      title: 'Forex 2 Minggu (Senin 02:00 WIB)'.slice(0, 40),
      description: `Otomatis mengambil jadwal kalender ekonomi USD untuk Minggu Ini & Minggu Depan (${startDate} s/d ${endDate}) setiap hari Senin pukul 02:00 WIB.`,
      cronExpression: '0 2 * * 1', // Setiap hari Senin jam 02:00 WIB
      timezone: 'Asia/Jakarta',
      isEnabled: true,
      isExclusive: false,
      actions: [
        {
          type: ScheduleActions.RunActor,
          actorId: resolvedActorId,
          runInput: {
            body: JSON.stringify(weeklyInput),
            contentType: 'application/json; charset=utf-8',
          },
        },
      ],
    };

    let weeklySchedule = existingSchedules.find(s => s.name === SCHEDULE_WEEKLY_NAME || (s.title && s.title.includes('Forex 2 Minggu')));
    if (weeklySchedule) {
      weeklySchedule = await client.schedule(weeklySchedule.id).update(weeklySchedulePayload);
      log.info(`✅ [APIFY SCHEDULE] Schedule Senin 02:00 WIB berhasil di-update (ID: ${weeklySchedule.id})`);
    } else {
      weeklySchedule = await client.schedules().create(weeklySchedulePayload);
      log.info(`🚀 [APIFY SCHEDULE] Schedule Senin 02:00 WIB berhasil dibuat (ID: ${weeklySchedule.id})`);
    }

    // 2. KONFIGURASI SCHEDULE JAM RILIS DATA HARI INI (HANYA HARI ITU AJA, BUKAN MINGGUAN)
    const sourceEvents = (calendarEvents && calendarEvents.length > 0) ? calendarEvents : (cache.data || []);
    const releaseInfo = getTodayReleaseScheduleInfo(sourceEvents);

    const releaseInput = {
      currencies: ['USD'],
      dateRange: 'today', // Khusus hari rilis itu saja (bukan seminggu/dua minggu)
      timeZone: 'UTC',
      maxItems: 60,
    };

    const upcomingLabels = releaseInfo.upcomingSlots.map(s => s.releaseTimeWIB).join(', ');
    const rawReleaseTitle = releaseInfo.hasActiveReleaseToday
      ? `Forex Rilis Hari Ini: ${upcomingLabels}`
      : `Forex Rilis Hari Ini (Standby)`;

    const releaseSchedulePayload = {
      name: SCHEDULE_RELEASE_NAME,
      title: rawReleaseTitle.slice(0, 40),
      description: releaseInfo.hasActiveReleaseToday
        ? `Otomatis mengambil data rilis USD HARI INI (${releaseInfo.todayDateWIB}) pada jam: ${upcomingLabels} (dateRange: today).`
        : `Jadwal rilis berita USD hari ini (${releaseInfo.todayDateWIB}). Otomatis aktif saat jam rilis data hari ini.`,
      cronExpression: releaseInfo.nextCronExpression,
      timezone: 'Asia/Jakarta',
      isEnabled: releaseInfo.hasActiveReleaseToday,
      isExclusive: false,
      actions: [
        {
          type: ScheduleActions.RunActor,
          actorId: resolvedActorId,
          runInput: {
            body: JSON.stringify(releaseInput),
            contentType: 'application/json; charset=utf-8',
          },
        },
      ],
    };

    let releaseSchedule = existingSchedules.find(s => s.name === SCHEDULE_RELEASE_NAME || (s.title && s.title.startsWith('Forex Rilis')));
    if (releaseSchedule) {
      releaseSchedule = await client.schedule(releaseSchedule.id).update(releaseSchedulePayload);
      log.info(`✅ [APIFY SCHEDULE] Schedule Jam Rilis Hari Ini di-update (dateRange: today, Cron="${releaseInfo.nextCronExpression}", Enabled=${releaseInfo.hasActiveReleaseToday})`);
    } else {
      releaseSchedule = await client.schedules().create(releaseSchedulePayload);
      log.info(`🚀 [APIFY SCHEDULE] Schedule Jam Rilis Hari Ini dibuat (dateRange: today, Cron="${releaseInfo.nextCronExpression}", Enabled=${releaseInfo.hasActiveReleaseToday})`);
    }

    // Invalidate status cache agar UI / Telegram langsung mendapat data terbaru
    apifyStatusCache.timestamp = 0;

    return {
      success: true,
      weeklySchedule,
      releaseSchedule,
      releaseInfo,
    };
  } catch (err) {
    log.warn(`Gagal sinkronisasi Schedule Apify: ${err.message}`);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Ambil informasi Limit Saldo / Usage Kredit Apify + Daftar Schedule Apify aktif.
 */
export async function getApifyStatusAndSchedules(knownEvents = [], forceRefresh = false) {
  const token = getActiveApifyToken();
  const now = Date.now();
  if (!forceRefresh && apifyStatusCache.data && (now - apifyStatusCache.timestamp) < 30000) {
    return apifyStatusCache.data;
  }

  const sourceEvents = (knownEvents && knownEvents.length > 0) ? knownEvents : (cache.data || []);
  const releaseInfo = getTodayReleaseScheduleInfo(sourceEvents);
  const { startDate, endDate } = getThisAndNextWeekDateRange();

  if (!isApifyConfigured()) {
    return {
      configured: false,
      error: 'APIFY_TOKEN belum di-set di file .env',
      limits: null,
      schedules: [],
      releaseInfo,
      twoWeeksRange: { startDate, endDate },
    };
  }

  try {
    const client = new ApifyClient({ token });

    const [userInfo, limitsInfo, schedulesList] = await Promise.all([
      client.user().get().catch(() => null),
      client.user().limits().catch(() => null),
      client.schedules().list().catch(() => ({ items: [] })),
    ]);

    let limitsData = null;
    if (limitsInfo) {
      const usedUsd = Number(limitsInfo.current?.monthlyUsageUsd || 0);
      const maxUsd = Number(limitsInfo.limits?.maxMonthlyUsageUsd || userInfo?.plan?.maxMonthlyUsageUsd || 5);
      const remainingUsd = Math.max(0, maxUsd - usedUsd);
      const usagePercent = maxUsd > 0 ? Math.min(100, Math.round((usedUsd / maxUsd) * 1000) / 10) : 0;

      const cycleStart = limitsInfo.monthlyUsageCycle?.startAt
        ? new Date(limitsInfo.monthlyUsageCycle.startAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' })
        : '-';
      const cycleEnd = limitsInfo.monthlyUsageCycle?.endAt
        ? new Date(limitsInfo.monthlyUsageCycle.endAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' })
        : '-';

      limitsData = {
        username: userInfo?.username || 'Apify User',
        plan: userInfo?.plan?.id || userInfo?.plan?.description || 'Personal / Free',
        usedUsd: usedUsd.toFixed(2),
        maxUsd: maxUsd.toFixed(2),
        remainingUsd: remainingUsd.toFixed(2),
        usagePercent,
        computeUnitsUsed: Number(limitsInfo.current?.monthlyActorComputeUnits || 0).toFixed(3),
        computeUnitsMax: Number(limitsInfo.limits?.maxMonthlyActorComputeUnits || 0),
        cycleStart,
        cycleEnd,
      };
    }

    const formattedSchedules = (schedulesList?.items || [])
      .filter(sch => !(sch.name === 'my-schedule' && !sch.isEnabled))
      .map(sch => {
      const nextRunWIB = sch.nextRunAt
        ? new Date(sch.nextRunAt).toLocaleString('id-ID', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta',
          }) + ' WIB'
        : 'Tidak dijadwalkan (Nonaktif)';

      const lastRunWIB = sch.lastRunAt
        ? new Date(sch.lastRunAt).toLocaleString('id-ID', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta',
          }) + ' WIB'
        : 'Belum pernah dijalankan';

      return {
        id: sch.id,
        name: sch.name,
        title: sch.title || sch.name,
        description: sch.description || '',
        cronExpression: sch.cronExpression,
        timezone: sch.timezone || 'Asia/Jakarta',
        isEnabled: Boolean(sch.isEnabled),
        nextRunAt: sch.nextRunAt || null,
        nextRunWIB,
        lastRunAt: sch.lastRunAt || null,
        lastRunWIB,
        consoleUrl: `https://console.apify.com/schedules/${sch.id}`,
      };
    });

    const result = {
      configured: true,
      limits: limitsData,
      schedules: formattedSchedules,
      releaseInfo,
      twoWeeksRange: { startDate, endDate },
      updatedAtWIB: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB',
    };

    apifyStatusCache = {
      data: result,
      timestamp: now,
    };

    return result;
  } catch (err) {
    log.warn(`Error getApifyStatusAndSchedules: ${err.message}`);
    return {
      configured: true,
      error: err.message,
      limits: null,
      schedules: [],
      releaseInfo,
      twoWeeksRange: { startDate, endDate },
    };
  }
}

/**
 * Helper untuk fetch dataset Apify:
 * - Jika forceLiveRun === false: Selalu coba ambil dataset dari run terakhir ($0 Cost, hemat kredit).
 * - Jika forceLiveRun === true: Eksekusi Live Actor Run Apify.
 */
async function fetchActorDataset(actorId, input, forceLiveRun = false) {
  const token = getActiveApifyToken();
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

  // 2. STRATEGI LIVE ACTOR RUN via Apify SDK (Dipanggil saat jadwal Senin 02:00 WIB / jam rilis data / refresh manual)
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
 * 1. Awal Minggu / Senin 02:00 WIB: scope = 'two_weeks' (Minggu ini & Next week)
 * 2. Saat Jam Rilis Data / Refresh Minggu Ini: scope = 'this_week' (Update nilai actual/forecast)
 * 
 * Melindungi dari pemborosan kuota Apify dengan cooldown 3 menit.
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
    log.info(`🌐 [APIFY SYNC 2 MINGGU] Mengambil data This Week & Next Week: ${startDate} s/d ${endDate}`);
    input = {
      currencies: ['USD'],
      dateRange: 'custom',
      startDate,
      endDate,
      timeZone: 'UTC',
      maxItems: 400,
    };
  } else if (scope === 'today') {
    log.info(`🌐 [APIFY SYNC RILIS HARI INI] Mengambil data HARI INI SAJA (today)...`);
    input = {
      currencies: ['USD'],
      dateRange: 'today', // Khusus hari itu saja sesuai rilis berita
      timeZone: 'UTC',
      maxItems: 60,
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

  // Jika scrape scope 'today', gabungkan dengan cache data mingguan agar jadwal hari lain tidak hilang
  const itemsToMerge = scope === 'today' && cache.data && cache.data.length > 0
    ? [...cache.data, ...formattedItems]
    : formattedItems;

  const finalEvents = deduplicateCalendarItems(itemsToMerge);
  log.info(`✅ Apify Sync (${scope}) Berhasil! Diperoleh ${formattedItems.length} item baru (Total database/cache: ${finalEvents.length} events).`);
  logScrapeResult('ApifyCalendar', true, finalEvents.length);

  // Simpan / upsert langsung ke Database Supabase
  await saveUnifiedFeedToSupabase(finalEvents).catch(e => log.warn(`Gagal save Apify events ke Supabase: ${e.message}`));

  cache.data = finalEvents;
  cache.timestamp = now;

  // Update otomatis jadwal Schedule di Apify Console sesuai jam rilis terbaru
  syncApifyCloudSchedules(finalEvents).catch(e => log.debug(`Auto-update Apify schedule info: ${e.message}`));

  return finalEvents;
}

/**
 * Cek apakah saat ini tepat berada di hari & jam rilis data kalender ekonomi USD.
 * Anti Double-Run Protection:
 * 1. Cek apakah slot jam rilis ini sudah pernah di-sync hari ini (cegah run berulang).
 * 2. Cek apakah Schedule di Apify Cloud SEDANG RUNNING: jika ya, tunggu selesai dan ambil hasilnya ($0 Cost, cegah double run!).
 * 3. Cek apakah Schedule di Apify Cloud BARU SELESAI (< 3 menit): jika ya, ambil datasetnya ($0 Cost, cegah double run!).
 * 4. Hanya jika Schedule Cloud belum/tidak jalan, bot jalankan live sync khusus 'today'.
 */
export async function checkAndRunReleaseTimeSync(knownEvents = []) {
  if (!isApifyConfigured()) return null;

  const now = Date.now();
  const sourceEvents = (knownEvents && knownEvents.length > 0) ? knownEvents : (cache.data || []);
  const releaseInfo = getTodayReleaseScheduleInfo(sourceEvents);

  if (!releaseInfo.slots || releaseInfo.slots.length === 0) {
    return null;
  }

  // Cari slot rilis hari ini yang sudah memasuki jendela rilis (H+45 detik s/d H+10 menit) dan masih ada event yang actual === '-'
  const releaseDelayMs = 45 * 1000; // 45 detik setelah jam rilis
  const releaseWindowMs = 10 * 60 * 1000; // 10 menit jendela pantau rilis

  const dueSlot = releaseInfo.slots.find(slot => {
    const isInsideWindow = now >= (slot.timestamp + releaseDelayMs) && now <= (slot.timestamp + releaseWindowMs);
    return isInsideWindow && !slot.allReleased;
  });

  if (!dueSlot) {
    return null;
  }

  const slotSyncKey = `${releaseInfo.todayDateWIB}_${dueSlot.releaseTimeWIB}`;
  // 1. CEK ANTI DOUBLE-RUN: Jika slot jam rilis ini sudah pernah diproses hari ini, lewati!
  if (syncedReleaseKeys.has(slotSyncKey)) {
    return null;
  }

  const pendingNames = dueSlot.events.filter(e => !e.actual || e.actual === '-').map(e => e.event).join(', ');
  const token = getActiveApifyToken();
  const client = new ApifyClient({ token });
  const actorId = config.APIFY_ACTOR_ID || 'silentflow/forexfactory-scraper';

  // 2. CEK STATUS RUN APIFY CLOUD: Jangan jalankan run baru jika Schedule Cloud sedang/baru berjalan!
  try {
    const recentRuns = await client.runs().list({ limit: 1, desc: true });
    const latestRun = recentRuns.items?.[0];

    if (latestRun) {
      const runStartedMs = new Date(latestRun.startedAt).getTime();
      const isRecent = (now - runStartedMs) <= (5 * 60 * 1000); // Run terjadi dalam 5 menit terakhir

      // Kasus A: Schedule Apify Cloud SEDANG RUNNING -> Tunggu sampai selesai (cegah double run!)
      if (latestRun.status === 'RUNNING' && isRecent) {
        log.info(`⏳ [APIFY SCHEDULE ACTIVE] Terdeteksi run Apify Cloud sedang berjalan (${latestRun.id}). Menunggu hasil selesai ($0 Cost)...`);
        const finishedRun = await client.run(latestRun.id).waitForFinish({ waitSecs: 35 });
        if (finishedRun && finishedRun.defaultDatasetId) {
          const { items } = await client.dataset(finishedRun.defaultDatasetId).listItems();
          if (Array.isArray(items) && items.length > 0) {
            log.info(`✅ [APIFY $0 SYNC] Menggunakan hasil run Apify Cloud (${items.length} events) tanpa menduplikasi run!`);
            const formatted = deduplicateCalendarItems(items.map((it, idx) => formatApifyItem(it, idx)));
            const merged = deduplicateCalendarItems([...(cache.data || []), ...formatted]);
            await saveUnifiedFeedToSupabase(merged).catch(() => {});
            cache.data = merged;
            cache.timestamp = now;
            syncedReleaseKeys.add(slotSyncKey);
            syncApifyCloudSchedules(merged).catch(() => {});
            return merged;
          }
        }
      }

      // Kasus B: Schedule Apify Cloud BARU SAJA SUCCEEDED (< 3 menit yang lalu) -> Ambil datasetnya langsung!
      if (latestRun.status === 'SUCCEEDED' && isRecent && latestRun.defaultDatasetId) {
        const { items } = await client.dataset(latestRun.defaultDatasetId).listItems();
        if (Array.isArray(items) && items.length > 0) {
          const formatted = deduplicateCalendarItems(items.map((it, idx) => formatApifyItem(it, idx)));
          const updatedSlotInfo = getTodayReleaseScheduleInfo(formatted);
          const matchingSlot = updatedSlotInfo.slots.find(s => s.releaseTimeWIB === dueSlot.releaseTimeWIB);

          if (matchingSlot && matchingSlot.allReleased) {
            log.info(`✅ [APIFY $0 SYNC] Data Actual jam ${dueSlot.releaseTimeWIB} (${pendingNames}) berhasil didapat dari run Apify Cloud terakhir!`);
            const merged = deduplicateCalendarItems([...(cache.data || []), ...formatted]);
            await saveUnifiedFeedToSupabase(merged).catch(() => {});
            cache.data = merged;
            cache.timestamp = now;
            syncedReleaseKeys.add(slotSyncKey);
            syncApifyCloudSchedules(merged).catch(() => {});
            return merged;
          }
        }
      }
    }
  } catch (cloudCheckErr) {
    log.debug(`Cek cloud run error: ${cloudCheckErr.message}`);
  }

  // 3. Fallback: Jika Schedule Cloud tidak berjalan dan cooldown lewat, jalankan sync 'today' (HANYA HARI ITU AJA)
  if ((now - lastLiveRunTimestamp) >= LIVE_RUN_COOLDOWN_MS) {
    log.info(`⏰ [JADWAL RILIS TIBA - ${dueSlot.releaseTimeWIB}] Menjalankan Apify (scope: today) untuk mengambil Actual: ${pendingNames}`);
    syncedReleaseKeys.add(slotSyncKey);
    const syncedEvents = await syncApifyCalendar({ scope: 'today', force: true });
    return syncedEvents;
  }

  return null;
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

