import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchApifyCalendar, isApifyConfigured, clearApifyCache, syncApifyCalendar } from './apifyCalendar.js';
import { normalizeCalendarTitleKey } from './parser.js';

const log = createLogger('ForexFactoryCalendar');

let localCalendarCache = {
  data: null,
  timestamp: 0,
};

/**
 * Mengambil data kalender ekonomi murni dari Apify (Silentflow Forex Factory Scraper).
 * TIDAK lagi mengambil dari FairEconomy ff_calendar_thisweek.json / xml untuk mencegah
 * duplikasi data dan ketidakkonsistenan waktu (jam kosong vs ada jam).
 * 
 * @param {boolean} forceLiveSync - Jika true, jalankan live sync Apify
 * @param {string} range - 'weekly' / 'two_weeks' (Minggu ini & Next week) atau 'this_week' (Refresh minggu ini)
 * @returns {Promise<Array>} Array event kalender terstandarisasi
 */
export async function getHighImpactNews(forceLiveSync = false, range = 'this_week') {
  const now = Date.now();

  // Gunakan cache jika masih valid dan bukan force sync
  if (!forceLiveSync && localCalendarCache.data && localCalendarCache.data.length > 0 && (now - localCalendarCache.timestamp) < config.APIFY_CACHE_TTL_MS) {
    return localCalendarCache.data;
  }

  try {
    let events = [];

    if (forceLiveSync) {
      const scope = (range === 'weekly' || range === 'two_weeks') ? 'two_weeks' : 'this_week';
      events = await syncApifyCalendar({ scope, force: true });
    } else {
      events = await fetchApifyCalendar({ forceLiveRun: false });
    }

    const filtered = (events || []).filter(e => {
      const curr = (e.currency || 'USD').toUpperCase();
      return curr === 'USD' || curr === 'ALL';
    });

    localCalendarCache.data = filtered;
    localCalendarCache.timestamp = now;
    return filtered;
  } catch (err) {
    log.error('Gagal mengambil kalender Forex Factory via Apify:', err.message);
    return localCalendarCache.data || [];
  }
}

export function clearCache() {
  localCalendarCache = { data: null, timestamp: 0 };
  clearApifyCache();
}
