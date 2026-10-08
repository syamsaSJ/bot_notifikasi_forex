import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { parseEconomicValue, formatWIBTime } from './parser.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';

const log = createLogger('RapidApiCalendar');
const CACHE_FILE_PATH = path.resolve('scratch', 'rapidapi_calendar_cache.json');
const ENDPOINT = '/get_real_time_calendar_details';
const API_TIMEZONE = 'GMT+07:00 Jakarta'; // Langsung minta waktu dalam WIB
const WIB_OFFSET = '+07:00';

/**
 * State cache + quota (dipersist ke disk agar restart tidak membakar kuota RapidAPI).
 * - events: hasil mapping event kalender hari ini
 * - dayKey: tanggal WIB (YYYY-MM-DD) yang di-cache
 * - lastFetch: timestamp fetch sukses terakhir
 * - blockedUntil: jangan panggil API sebelum waktu ini (kuota habis / 429)
 * - remaining / limit: info kuota dari header x-ratelimit-*
 */
let state = {
  events: [],
  dayKey: null,
  lastFetch: 0,
  lastAttempt: 0,
  blockedUntil: 0,
  remaining: null,
  limit: null,
};

try {
  if (fs.existsSync(CACHE_FILE_PATH)) {
    const saved = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
    if (saved && typeof saved === 'object') {
      state = { ...state, ...saved };
      log.info(`💾 Memuat ${state.events?.length || 0} event RapidAPI dari cache disk (${state.dayKey}).`);
    }
  }
} catch (e) {
  log.warn(`Gagal membaca cache RapidAPI: ${e.message}`);
}

function persist() {
  try {
    const dir = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    log.warn(`Gagal menyimpan cache RapidAPI: ${e.message}`);
  }
}

export function isRapidApiConfigured() {
  return Boolean(config.RAPIDAPI_KEY && !config.RAPIDAPI_KEY.includes('your_'));
}

function getTodayWIBParts() {
  const dayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  const [year, month, day] = dayKey.split('-').map(Number);
  return { dayKey, year, month, day };
}

function normalizeImpact(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('high')) return 'high';
  if (s.includes('medium')) return 'medium';
  return 'low';
}

function cleanValue(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '-';
  // Bond auction dsb. memakai format "5.30|2.8" (yield|bid-to-cover)
  return s.includes('|') ? s.split('|').map(p => p.trim()).join(' | ') : s;
}

function primaryNumeric(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return parseEconomicValue(s.split('|')[0]);
}

/**
 * Mapping response RapidAPI -> format event internal (sama dengan forexFactory.js).
 * Contoh item: { date: '2026-10-08', time: '19:30', currency: 'USD', impact: 'Medium Impact Expected',
 *               name: 'Unemployment Claims', actual: '', forecast: '200K', previous: '197K' }
 */
function mapEvent(item) {
  const dateStr = item.date;
  const timeStr = String(item.time || '').trim();
  const hasClock = /^\d{1,2}:\d{2}$/.test(timeStr);
  const hhmm = hasClock ? timeStr.padStart(5, '0') : '00:00';
  const dateObj = new Date(`${dateStr}T${hhmm}:00${WIB_OFFSET}`);
  const wibInfo = formatWIBTime(isNaN(dateObj.getTime()) ? new Date() : dateObj);
  const title = item.name || 'Economic News';

  return {
    id: `ff_rapid_${dateStr}_${title}`,
    source: 'Forex Factory',
    date: wibInfo.dateStr,
    time: hasClock ? `${hhmm} WIB` : (timeStr || 'All Day'),
    timeWIB: hasClock ? wibInfo.displayWIB : `${wibInfo.displayWIB.split('•')[0].trim()} • ${timeStr || 'All Day'}`,
    timestamp: wibInfo.timestamp,
    hasClockTime: hasClock,
    currency: (item.currency || '').toUpperCase(),
    impact: normalizeImpact(item.impact),
    event: title,
    actual: cleanValue(item.actual),
    forecast: cleanValue(item.forecast),
    previous: cleanValue(item.previous),
    actualValue: primaryNumeric(item.actual),
    forecastValue: primaryNumeric(item.forecast),
    previousValue: primaryNumeric(item.previous),
  };
}

/**
 * Tentukan apakah perlu memanggil RapidAPI sekarang (hemat kuota).
 * Fetch hanya jika:
 *  1. Belum ada data untuk hari ini (WIB), atau
 *  2. Ada event dengan forecast yang jam rilisnya sudah lewat tapi 'actual' belum terisi
 *     (dalam jendela RAPIDAPI_RELEASE_WINDOW_MS), dengan jeda minimal RAPIDAPI_MIN_INTERVAL_MS, atau
 *  3. Data sudah lebih tua dari RAPIDAPI_CALENDAR_TTL_MS (refresh jadwal berkala).
 */
function shouldFetch(now, dayKey) {
  if (now < state.blockedUntil) return { fetch: false, reason: 'quota-blocked' };
  if (state.dayKey !== dayKey || !state.lastFetch) return { fetch: true, reason: 'new-day' };

  const sinceAttempt = now - Math.max(state.lastAttempt || 0, state.lastFetch);
  if (sinceAttempt < config.RAPIDAPI_MIN_INTERVAL_MS) return { fetch: false, reason: 'min-interval' };

  const releaseDelay = config.RAPIDAPI_RELEASE_DELAY_MS;
  const pending = (state.events || []).filter(e =>
    e.hasClockTime &&
    (e.impact === 'high' || e.impact === 'medium') &&
    e.actual === '-' &&
    e.forecast !== '-' &&
    now >= e.timestamp + releaseDelay &&
    now <= e.timestamp + config.RAPIDAPI_RELEASE_WINDOW_MS &&
    state.lastFetch < now - releaseDelay
  );
  if (pending.length > 0) {
    return { fetch: true, reason: `awaiting-actual: ${pending.map(e => e.event).join(', ')}` };
  }

  if (now - state.lastFetch >= config.RAPIDAPI_CALENDAR_TTL_MS) return { fetch: true, reason: 'ttl-expired' };
  return { fetch: false, reason: 'cache-fresh' };
}

function updateQuotaFromHeaders(headers, now) {
  const remaining = parseInt(headers['x-ratelimit-requests-remaining'], 10);
  const limit = parseInt(headers['x-ratelimit-requests-limit'], 10);
  const resetSec = parseInt(headers['x-ratelimit-requests-reset'], 10);

  if (!isNaN(remaining)) state.remaining = remaining;
  if (!isNaN(limit)) state.limit = limit;

  if (!isNaN(remaining) && remaining <= 0) {
    state.blockedUntil = now + (!isNaN(resetSec) ? resetSec * 1000 : 60 * 60 * 1000);
    log.warn(`⛔ Kuota RapidAPI habis. Diblokir sampai ${new Date(state.blockedUntil).toISOString()}`);
  }
}

/**
 * Ambil kalender ekonomi realtime hari ini (WIB) dari RapidAPI Forex Factory Scraper.
 * @returns {Promise<Array|null>} array event, atau null jika RapidAPI tidak tersedia
 *          (belum dikonfigurasi / kuota habis tanpa cache) sehingga pemanggil bisa fallback.
 */
export async function fetchRapidApiCalendar() {
  if (!isRapidApiConfigured()) return null;

  const now = Date.now();
  const { dayKey, year, month, day } = getTodayWIBParts();
  const decision = shouldFetch(now, dayKey);
  const hasTodayCache = state.dayKey === dayKey && Array.isArray(state.events) && state.events.length > 0;

  if (!decision.fetch) {
    // Tanpa data hari ini (mis. kuota habis) -> null agar fallback scraper bekerja
    return hasTodayCache ? state.events : null;
  }

  log.info(`🌐 RapidAPI Forex Factory fetch (${decision.reason})...`);
  state.lastAttempt = now;

  try {
    const res = await axios.get(`https://${config.RAPIDAPI_FF_HOST}${ENDPOINT}`, {
      params: {
        calendar: 'Forex',
        year,
        month,
        day,
        currency: 'USD',
        event_name: 'ALL',
        timezone: API_TIMEZONE,
        time_format: '24h',
      },
      headers: {
        'x-rapidapi-host': config.RAPIDAPI_FF_HOST,
        'x-rapidapi-key': config.RAPIDAPI_KEY,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    updateQuotaFromHeaders(res.headers, now);

    if (res.status === 429) {
      if (state.blockedUntil <= now) state.blockedUntil = now + 60 * 60 * 1000;
      throw new Error('HTTP 429 - kuota/rate limit RapidAPI terlampaui');
    }
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`HTTP ${res.status} - response tidak valid`);
    }

    const events = res.data
      .filter(item => item && (item.currency || '').toUpperCase() === 'USD')
      .map(mapEvent)
      .sort((a, b) => a.timestamp - b.timestamp);

    state.events = events;
    state.dayKey = dayKey;
    state.lastFetch = now;
    persist();

    const quotaInfo = state.remaining !== null ? ` | sisa kuota ${state.remaining}/${state.limit ?? '?'}` : '';
    log.info(`✅ RapidAPI Forex Factory berhasil: ${events.length} USD events${quotaInfo}`);
    logScrapeResult('RapidAPI-ForexFactory', true, events.length);
    return events;
  } catch (err) {
    persist();
    log.warn(`Gagal fetch RapidAPI Forex Factory: ${err.message}`);
    logScrapeResult('RapidAPI-ForexFactory', false, 0, err.message);
    return hasTodayCache ? state.events : null;
  }
}

export function getRapidApiQuotaStatus() {
  return {
    remaining: state.remaining,
    limit: state.limit,
    blockedUntil: state.blockedUntil,
    lastFetch: state.lastFetch,
    dayKey: state.dayKey,
  };
}
