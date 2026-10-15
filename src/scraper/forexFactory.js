import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchForexFactoryCalendarPuppeteer, clearPuppeteerCache } from './puppeteerScraper.js';
import { fetchApifyCalendar, isApifyConfigured } from './apifyCalendar.js';

import { getFeedFromSupabase, isSupabaseConfigured } from '../services/supabaseService.js';

const log = createLogger('ForexFactoryCalendar');

let localCalendarCache = {
  data: null,
  timestamp: 0,
};

/**
 * Mengambil data kalender ekonomi Forex Factory:
 * 1. Gunakan cache memori jika masih valid (< 10 menit).
 * 2. Jika bukan force sync, gunakan data kalender dari Supabase (Instan & $0 Cost).
 * 3. Jalankan Puppeteer Stealth hanya saat forceLiveSync (Senin 02:00 / tombol Sync / startup jika kosong).
 * 
 * @param {boolean} forceLiveSync - Jika true, jalankan live sync Puppeteer
 * @param {string} range - 'weekly' / 'two_weeks' (Minggu ini & Next week) atau 'this_week' (Refresh minggu ini)
 * @returns {Promise<Array>} Array event kalender terstandarisasi
 */
export async function getHighImpactNews(forceLiveSync = false, range = 'two_weeks') {
  const now = Date.now();

  // 1. Gunakan cache memori jika masih valid dan bukan force sync
  if (!forceLiveSync && localCalendarCache.data && localCalendarCache.data.length > 0 && (now - localCalendarCache.timestamp) < (config.APIFY_CACHE_TTL_MS || 600000)) {
    return localCalendarCache.data;
  }

  // 2. Jika bukan force sync, prioritaskan data kalender yang sudah ada di Supabase
  if (!forceLiveSync && isSupabaseConfigured()) {
    try {
      const dbFeed = await getFeedFromSupabase();
      const calItems = (dbFeed || []).filter(item => item.itemType === 'calendar' || item.event);
      if (calItems.length > 0) {
        localCalendarCache.data = calItems;
        localCalendarCache.timestamp = now;
        return calItems;
      }
    } catch (dbErr) {
      log.debug(`Supabase read fallback info: ${dbErr.message}`);
    }
  }

  // 3. Jika bukan force sync (misalnya polling berkala 1 menit), JANGAN jalankan Puppeteer!
  // Puppeteer hanya dijalankan saat forceLiveSync = true (Senin jam 02:00 WIB atau tombol Sync Kalender diklik).
  if (!forceLiveSync) {
    return localCalendarCache.data || [];
  }

  // 4. Force sync on-demand (Senin 02:00 WIB atau Tombol Sync Kalender diklik): Jalankan Puppeteer Stealth
  try {
    const scope = (range === 'weekly' || range === 'two_weeks') ? 'two_weeks' : range;
    log.info(`📅 Menjalankan scrape kalender Forex Factory via Puppeteer Stealth (Scope: ${scope}, On-Demand/Senin 02:00 WIB)...`);
    
    let events = await fetchForexFactoryCalendarPuppeteer({ scope, force: true });

    // Fallback ke Apify HANYA jika Puppeteer gagal total dan Apify tersedia
    if ((!events || events.length === 0) && isApifyConfigured()) {
      log.warn('Puppeteer tidak mengembalikan data, mencoba fallback ke Apify...');
      events = await fetchApifyCalendar({ forceLiveRun: false });
    }

    const filtered = (events || []).filter(e => {
      const curr = (e.currency || 'USD').toUpperCase();
      return curr === 'USD' || curr === 'ALL';
    });

    if (filtered.length > 0) {
      localCalendarCache.data = filtered;
      localCalendarCache.timestamp = now;
    }
    return filtered;
  } catch (err) {
    log.error('Gagal mengambil kalender Forex Factory via Puppeteer:', err.message);
    return localCalendarCache.data || [];
  }
}

export function clearCache() {
  localCalendarCache = { data: null, timestamp: 0 };
  clearPuppeteerCache();
}
