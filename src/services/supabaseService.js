import { createClient } from '@supabase/supabase-js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';
import { normalizeCalendarTitleKey } from '../scraper/parser.js';
import { isRelevantToXAUUSD } from '../utils/newsFilter.js';

const log = createLogger('SupabaseService');

let supabaseClient = null;

if (config.SUPABASE_URL && config.SUPABASE_KEY && !config.SUPABASE_URL.includes('your-supabase')) {
  try {
    supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
    log.info('✅ Supabase Client terinisialisasi!');
  } catch (err) {
    log.error('Gagal inisialisasi Supabase Client:', err.message);
  }
} else {
  log.warn('⚠️ SUPABASE_URL atau SUPABASE_KEY belum di-set di file .env.');
}

/**
  * Cek apakah Supabase terhubung & aktif.
  */
export function isSupabaseConfigured() {
  return Boolean(supabaseClient);
}

/**
 * Hapus seluruh data lama dari tabel economic_calendar untuk pembersihan total duplikat.
 */
export async function clearEconomicCalendarTable() {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient
      .from('economic_calendar')
      .delete()
      .neq('id', 'non_existent_id_purge_all');

    if (error) {
      log.warn(`Gagal clear tabel economic_calendar: ${error.message}`);
      return false;
    }
    log.info('🧹 Tabel economic_calendar berhasil dibersihkan total.');
    return true;
  } catch (err) {
    log.error('Error saat clear tabel economic_calendar:', err.message);
    return false;
  }
}

/**
 * Hapus data kalender non-USD/ALL dari Supabase (khusus fokus pergerakan Emas/XAUUSD).
 */
export async function deleteNonUSDFromSupabase() {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient
      .from('economic_calendar')
      .delete()
      .not('currency', 'in', '("USD","ALL","All")');

    if (error) {
      log.warn(`Gagal hapus data non-USD/ALL dari Supabase: ${error.message}`);
      return false;
    }
    log.info('🧹 Berhasil membersihkan data kalender non-USD/ALL dari database Supabase.');
    return true;
  } catch (err) {
    log.error('Error saat hapus data non-USD/ALL dari Supabase:', err.message);
    return false;
  }
}

/**
  * Simpan/Upsert Feed Terpadu (Kalender Ekonomi & Headline News) ke Database Supabase.
  * @param {Array} items - Array items dari unifiedFeed
  */
export async function saveUnifiedFeedToSupabase(items) {
  if (!supabaseClient || !Array.isArray(items) || items.length === 0) {
    return false;
  }

  try {
    const calendarRows = [];
    const newsRows = [];

    items.forEach(item => {
      if (item.itemType === 'calendar') {
        const curr = (item.currency || 'USD').toUpperCase();
        if (curr !== 'USD' && curr !== 'ALL') return;

        const cleanEvt = normalizeCalendarTitleKey(item.event || item.title || '');
        const idFallback = `cal_${item.date || new Date().toISOString().split('T')[0]}_${curr}_${cleanEvt}`;

        calendarRows.push({
          id: item.id || idFallback,
          source: item.source || 'Forex Factory',
          event: item.event || item.title || 'Economic News',
          title: item.title || item.event || 'Economic News',
          currency: item.currency || 'USD',
          impact: item.impact || 'medium',
          date: item.date || new Date().toISOString().split('T')[0],
          time: item.time || 'TBD',
          time_wib: item.timeWIB || '',
          timestamp: item.timestamp || Date.now(),
          actual: item.actual || '-',
          forecast: item.forecast || '-',
          previous: item.previous || '-',
          actual_value: item.actualValue ?? null,
          forecast_value: item.forecastValue ?? null,
          previous_value: item.previousValue ?? null,
          signal: item.signal || null,
          analysis: item.analysis || null,
          updated_at: new Date().toISOString(),
        });
      } else {
        if (!isRelevantToXAUUSD(item.title || '')) return;
        newsRows.push({
          id: item.id || `news_${item.timestamp}_${(item.title || '').slice(0, 15)}`,
          source: item.source || 'Investing.com',
          title: item.title || 'Market News',
          link: item.link || '#',
          pub_date: item.pubDate || '',
          date: item.date || new Date().toISOString().split('T')[0],
          time_wib: item.timeWIB || '',
          timestamp: item.timestamp || Date.now(),
          category: item.category || 'Market News',
          signal: item.signal || null,
          analysis: item.analysis || null,
          updated_at: new Date().toISOString(),
        });
      }
    });

    let successCount = 0;

    // Deduplikasi array berdasarkan 'id' unik sebelum dipass ke Supabase upsert (Prioritas ACTUAL terisi)
    const uniqueCalMap = new Map();
    calendarRows.forEach(row => {
      if (!uniqueCalMap.has(row.id)) {
        uniqueCalMap.set(row.id, row);
      } else {
        const existing = uniqueCalMap.get(row.id);
        if (row.actual && row.actual !== '-' && (!existing.actual || existing.actual === '-')) {
          existing.actual = row.actual;
          existing.actual_value = row.actual_value;
          existing.signal = row.signal;
          existing.analysis = row.analysis;
        }
        if (row.forecast && row.forecast !== '-' && (!existing.forecast || existing.forecast === '-')) {
          existing.forecast = row.forecast;
          existing.forecast_value = row.forecast_value;
        }
        if (row.previous && row.previous !== '-' && (!existing.previous || existing.previous === '-')) {
          existing.previous = row.previous;
          existing.previous_value = row.previous_value;
        }
      }
    });
    const uniqueCalRows = Array.from(uniqueCalMap.values());

    const uniqueNewsMap = new Map();
    newsRows.forEach(row => uniqueNewsMap.set(row.id, row));
    const uniqueNewsRows = Array.from(uniqueNewsMap.values());

    // Protection & Smart Merge dengan Data Eksisting di Database Supabase
    if (uniqueCalRows.length > 0) {
      const calIds = uniqueCalRows.map(r => r.id);
      const { data: dbExisting } = await supabaseClient
        .from('economic_calendar')
        .select('*')
        .in('id', calIds);

      if (dbExisting && dbExisting.length > 0) {
        const dbMap = new Map(dbExisting.map(r => [r.id, r]));

        uniqueCalRows.forEach(row => {
          const dbRow = dbMap.get(row.id);
          if (dbRow) {
            // Protect Actual: jika data baru '-' tapi di DB sudah terisi angka actual, pertahankan data DB
            if ((!row.actual || row.actual === '-') && dbRow.actual && dbRow.actual !== '-') {
              row.actual = dbRow.actual;
              row.actual_value = dbRow.actual_value;
              row.signal = dbRow.signal;
              row.analysis = dbRow.analysis;
            }
            // Protect Forecast
            if ((!row.forecast || row.forecast === '-') && dbRow.forecast && dbRow.forecast !== '-') {
              row.forecast = dbRow.forecast;
              row.forecast_value = dbRow.forecast_value;
            }
            // Protect Previous
            if ((!row.previous || row.previous === '-') && dbRow.previous && dbRow.previous !== '-') {
              row.previous = dbRow.previous;
              row.previous_value = dbRow.previous_value;
            }
            // Protect time_wib jika DB sudah terisi jam presisi
            if (dbRow.time_wib && dbRow.time_wib.includes('WIB') && (!row.time_wib || !row.time_wib.includes('WIB'))) {
              row.time_wib = dbRow.time_wib;
              row.time = dbRow.time;
              row.timestamp = dbRow.timestamp;
            }
          }
        });
      }

      const { error: calErr } = await supabaseClient
        .from('economic_calendar')
        .upsert(uniqueCalRows, { onConflict: 'id' });

      if (calErr) {
        log.warn(`Gagal upsert kalender ke Supabase: ${calErr.message}`);
      } else {
        successCount += uniqueCalRows.length;
      }
    }

    // Upsert ke tabel 'news_headlines'
    if (uniqueNewsRows.length > 0) {
      const { error: newsErr } = await supabaseClient
        .from('news_headlines')
        .upsert(uniqueNewsRows, { onConflict: 'id' });

      if (newsErr) {
        log.warn(`Gagal upsert berita ke Supabase: ${newsErr.message}`);
      } else {
        successCount += uniqueNewsRows.length;
      }
    }

    log.info(`💾 Berhasil menyimpan ${successCount} data (Kalender & News) ke Supabase Database.`);
    return true;
  } catch (err) {
    log.error('Error saat menyimpan feed ke Supabase:', err.message);
    return false;
  }
}

/**
  * Ambil data feed terpadu dari Database Supabase untuk ditampilkan di Web UI / Bot Telegram.
  * @returns {Promise<Array|null>} Array items atau null jika Supabase error / kosong.
  */
export async function getFeedFromSupabase() {
  if (!supabaseClient) return null;

  try {
    const [{ data: calData, error: calErr }, { data: newsData, error: newsErr }] = await Promise.all([
      supabaseClient.from('economic_calendar').select('*').order('timestamp', { ascending: false }).limit(300),
      supabaseClient.from('news_headlines').select('*').order('timestamp', { ascending: false }).limit(200),
    ]);

    if (calErr) log.warn(`Gagal ambil kalender dari Supabase: ${calErr.message}`);
    if (newsErr) log.warn(`Gagal ambil berita dari Supabase: ${newsErr.message}`);

    const calMap = new Map();
    (calData || []).forEach(row => {
      const curr = (row.currency || 'USD').toUpperCase();
      if (curr !== 'USD' && curr !== 'ALL') return;

      const titleKey = normalizeCalendarTitleKey(row.event || row.title || '');
      const key = `${row.date}_${row.currency || 'USD'}_${titleKey}`;

      if (!calMap.has(key)) {
        calMap.set(key, {
          id: row.id,
          itemType: 'calendar',
          source: row.source,
          event: row.event,
          title: row.title,
          currency: row.currency,
          impact: row.impact,
          date: row.date,
          time: row.time,
          timeWIB: row.time_wib,
          timestamp: Number(row.timestamp),
          actual: row.actual,
          forecast: row.forecast,
          previous: row.previous,
          actualValue: row.actual_value,
          forecastValue: row.forecast_value,
          previousValue: row.previous_value,
          signal: row.signal,
          analysis: row.analysis,
        });
      } else {
        const existing = calMap.get(key);
        // Prioritaskan data ACTUAL yang sudah terisi dibanding '-'
        if (row.actual && row.actual !== '-' && (!existing.actual || existing.actual === '-')) {
          existing.actual = row.actual;
          existing.actualValue = row.actual_value;
          existing.signal = row.signal;
          existing.analysis = row.analysis;
        }
      }
    });

    const newsMap = new Map();
    (newsData || []).forEach(row => {
      if (!isRelevantToXAUUSD(row.title)) return;
      const cleanTitle = (row.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 35);
      const key = `news_${row.date || ''}_${cleanTitle}`;
      if (!newsMap.has(key)) {
        newsMap.set(key, {
          id: row.id,
          itemType: 'investing',
          source: row.source,
          title: row.title,
          link: row.link,
          pubDate: row.pub_date,
          date: row.date,
          timeWIB: row.time_wib,
          timestamp: Number(row.timestamp),
          category: row.category,
          signal: row.signal,
          analysis: row.analysis,
        });
      }
    });

    const calendarItems = Array.from(calMap.values());
    const newsItems = Array.from(newsMap.values());

    const merged = [...calendarItems, ...newsItems].sort((a, b) => b.timestamp - a.timestamp);

    if (merged.length > 0) {
      log.info(`⚡ Berhasil mengambil ${merged.length} data berita & kalender LANGSUNG dari Database Supabase!`);
      return merged;
    }

    return null;
  } catch (err) {
    log.error('Error saat mengambil data dari Supabase:', err.message);
    return null;
  }
}
