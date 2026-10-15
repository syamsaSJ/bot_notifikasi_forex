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
 * Hapus data duplikat legacy dari sumber FairEconomy ff_json_ dan ff_xml_
 * yang menyebabkan data ganda tanpa jam di Supabase.
 */
export async function cleanLegacyDuplicateCalendarEntries() {
  if (!supabaseClient) return false;
  try {
    // 1. Hapus entri legacy ff_json_ dan ff_xml_
    const { error: err1 } = await supabaseClient
      .from('economic_calendar')
      .delete()
      .like('id', 'ff_json_%');

    const { error: err2 } = await supabaseClient
      .from('economic_calendar')
      .delete()
      .like('id', 'ff_xml_%');

    if (err1 || err2) {
      log.warn(`Gagal membersihkan data legacy ff_json/ff_xml: ${err1?.message || err2?.message}`);
    }

    // 2. Deteksi & bersihkan entri duplikat lintas tanggal akibat offset waktu (misal run Apify lama vs Puppeteer baru)
    const { data: allCal, error: fetchErr } = await supabaseClient
      .from('economic_calendar')
      .select('*')
      .order('date', { ascending: true });

    if (!fetchErr && Array.isArray(allCal) && allCal.length > 0) {
      const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const groups = new Map();

      allCal.forEach(item => {
        const key = (item.currency || 'USD') + '__' + norm(item.event);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });

      const idsToDelete = [];
      for (const [key, items] of groups.entries()) {
        if (items.length > 1) {
          if (key.includes('imfmeetings')) continue; // IMF meetings adalah event multi-hari yang sah

          for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
              const item1 = items[i];
              const item2 = items[j];
              const d1 = new Date(item1.date).getTime();
              const d2 = new Date(item2.date).getTime();
              const diffDays = Math.abs(d2 - d1) / (1000 * 60 * 60 * 24);

              // Jika selisih hari <= 1 hari dan salah satunya adalah event tentative / all-day
              if (diffDays <= 1) {
                const isTentative1 = !item1.time || item1.time === '-' || /all day|tentative/i.test(item1.time);
                const isTentative2 = !item2.time || item2.time === '-' || /all day|tentative/i.test(item2.time);

                if (isTentative1 || isTentative2) {
                  let keepItem = item1;
                  let deleteItem = item2;
                  
                  // Utamakan entri yang memiliki jam WIB spesifik/presisi hasil konversi dateline
                  const hasTime1 = item1.time && item1.time !== '-' && !/all day/i.test(item1.time);
                  const hasTime2 = item2.time && item2.time !== '-' && !/all day/i.test(item2.time);

                  if (hasTime2 && !hasTime1) {
                    keepItem = item2;
                    deleteItem = item1;
                  } else if (hasTime1 && !hasTime2) {
                    keepItem = item1;
                    deleteItem = item2;
                  }

                  const updates = {};
                  if ((!keepItem.actual || keepItem.actual === '-') && deleteItem.actual && deleteItem.actual !== '-') {
                    updates.actual = deleteItem.actual;
                    updates.actual_value = deleteItem.actual_value;
                  }
                  if ((!keepItem.forecast || keepItem.forecast === '-') && deleteItem.forecast && deleteItem.forecast !== '-') {
                    updates.forecast = deleteItem.forecast;
                    updates.forecast_value = deleteItem.forecast_value;
                  }
                  if ((!keepItem.previous || keepItem.previous === '-') && deleteItem.previous && deleteItem.previous !== '-') {
                    updates.previous = deleteItem.previous;
                    updates.previous_value = deleteItem.previous_value;
                  }

                  if (Object.keys(updates).length > 0) {
                    await supabaseClient.from('economic_calendar').update(updates).eq('id', keepItem.id);
                  }

                  idsToDelete.push(deleteItem.id);
                }
              }
            }
          }
        }
      }

      if (idsToDelete.length > 0) {
        log.info(`🧹 Menghapus ${idsToDelete.length} entri duplikat kalender lintas-tanggal dari Supabase: ${idsToDelete.join(', ')}`);
        await supabaseClient.from('economic_calendar').delete().in('id', idsToDelete);
      }
    }

    log.info('🧹 Berhasil membersihkan seluruh entri duplikat dari Supabase.');
    return true;
  } catch (err) {
    log.error('Error saat membersihkan entri legacy/duplikat di Supabase:', err.message);
    return false;
  }
}

/**
 * Cek apakah jadwal kalender next week sudah tersimpan di Supabase.
 * Melindungi dari pemborosan kuota Apify jika server Render restart atau sleep-wake pada hari Senin.
 */
export async function hasNextWeekCalendarInSupabase() {
  if (!supabaseClient) return false;
  try {
    const now = new Date();
    const dateStrWIB = now.toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE || 'Asia/Jakarta' });
    const [y, m, d] = dateStrWIB.split('-').map(Number);
    const todayUtc = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = todayUtc.getUTCDay();
    const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);

    const mondayNextWeek = new Date(todayUtc);
    mondayNextWeek.setUTCDate(todayUtc.getUTCDate() + diffToMonday + 7);
    const sundayNextWeek = new Date(mondayNextWeek);
    sundayNextWeek.setUTCDate(mondayNextWeek.getUTCDate() + 6);

    const startNextWeek = mondayNextWeek.toISOString().split('T')[0];
    const endNextWeek = sundayNextWeek.toISOString().split('T')[0];

    const { data, error } = await supabaseClient
      .from('economic_calendar')
      .select('id')
      .gte('date', startNextWeek)
      .lte('date', endNextWeek)
      .limit(3);

    if (error) return false;
    return Boolean(data && data.length > 0);
  } catch (e) {
    return false;
  }
}

/**
 * Cek apakah jadwal kalender minggu ini sudah ada di Supabase.
 */
export async function hasThisWeekCalendarInSupabase() {
  if (!supabaseClient) return false;
  try {
    const now = new Date();
    const dateStrWIB = now.toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE || 'Asia/Jakarta' });
    const [y, m, d] = dateStrWIB.split('-').map(Number);
    const todayUtc = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = todayUtc.getUTCDay();
    const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);

    const mondayThisWeek = new Date(todayUtc);
    mondayThisWeek.setUTCDate(todayUtc.getUTCDate() + diffToMonday);
    const sundayThisWeek = new Date(mondayThisWeek);
    sundayThisWeek.setUTCDate(mondayThisWeek.getUTCDate() + 6);

    const startThisWeek = mondayThisWeek.toISOString().split('T')[0];
    const endThisWeek = sundayThisWeek.toISOString().split('T')[0];

    const { data, error } = await supabaseClient
      .from('economic_calendar')
      .select('id')
      .gte('date', startThisWeek)
      .lte('date', endThisWeek)
      .limit(3);

    if (error) return false;
    return Boolean(data && data.length > 0);
  } catch (e) {
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
        const dateStr = item.date || new Date().toISOString().split('T')[0];
        const eventId = (item.id && item.id.startsWith('cal_')) ? item.id : `cal_${dateStr}_${curr}_${cleanEvt}`;

        calendarRows.push({
          id: eventId,
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

      // Deteksi & bersihkan secara proaktif duplikat sibling lintas-tanggal (misal legacy Apify offset +1 hari)
      const siblingIdsToCheck = [];
      const siblingTargetMap = new Map();

      uniqueCalRows.forEach(row => {
        const isTentative = !row.time || row.time === '-' || /all day|tentative/i.test(row.time_wib || '');
        if (isTentative && row.date) {
          const cleanEvt = normalizeCalendarTitleKey(row.event || row.title || '');
          const d = new Date(row.date);
          const nextD = new Date(d);
          nextD.setUTCDate(d.getUTCDate() + 1);
          const nextDateStr = nextD.toISOString().split('T')[0];
          const nextId = `cal_${nextDateStr}_${row.currency}_${cleanEvt}`;
          siblingIdsToCheck.push(nextId);
          siblingTargetMap.set(nextId, row);

          const prevD = new Date(d);
          prevD.setUTCDate(d.getUTCDate() - 1);
          const prevDateStr = prevD.toISOString().split('T')[0];
          const prevId = `cal_${prevDateStr}_${row.currency}_${cleanEvt}`;
          siblingIdsToCheck.push(prevId);
          siblingTargetMap.set(prevId, row);
        }
      });

      if (siblingIdsToCheck.length > 0) {
        const { data: siblings } = await supabaseClient
          .from('economic_calendar')
          .select('*')
          .in('id', siblingIdsToCheck);

        if (siblings && siblings.length > 0) {
          const delIds = [];
          siblings.forEach(s => {
            const targetRow = siblingTargetMap.get(s.id);
            if (targetRow) {
              if ((!targetRow.actual || targetRow.actual === '-') && s.actual && s.actual !== '-') {
                targetRow.actual = s.actual;
                targetRow.actual_value = s.actual_value;
              }
              if ((!targetRow.forecast || targetRow.forecast === '-') && s.forecast && s.forecast !== '-') {
                targetRow.forecast = s.forecast;
                targetRow.forecast_value = s.forecast_value;
              }
              if ((!targetRow.previous || targetRow.previous === '-') && s.previous && s.previous !== '-') {
                targetRow.previous = s.previous;
                targetRow.previous_value = s.previous_value;
              }
              delIds.push(s.id);
            }
          });

          if (delIds.length > 0) {
            log.info(`🧹 Proaktif membersihkan ${delIds.length} entri duplikat sibling kalender: ${delIds.join(', ')}`);
            await supabaseClient.from('economic_calendar').delete().in('id', delIds);
          }
        }
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

/**
 * =========================================================================
 * Manajemen Subscriber Telegram (Auto-subscribe via Supabase)
 * =========================================================================
 */

/**
 * Simpan atau perbarui data subscriber Telegram ke Supabase saat /start atau /subscribe.
 * @param {Object} param0
 * @param {string|number} param0.chatId
 * @param {string} [param0.username]
 * @param {string} [param0.firstName]
 * @param {string} [param0.lastName]
 */
export async function addOrUpdateSubscriber({ chatId, username = '', firstName = '', lastName = '' }) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient
      .from('telegram_subscribers')
      .upsert({
        chat_id: String(chatId),
        username: username || '',
        first_name: firstName || '',
        last_name: lastName || '',
        is_active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'chat_id' });

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('does not exist')) {
        log.warn('⚠️ Tabel telegram_subscribers belum dibuat di Supabase. Jalankan query SQL dari supabase_schema.sql di Supabase SQL Editor.');
      } else {
        log.warn(`Gagal simpan subscriber ${chatId}: ${error.message}`);
      }
      return false;
    }

    log.info(`👤 Subscriber baru / aktif terdaftar: ${chatId} (${username ? '@' + username : firstName || 'User'})`);
    return true;
  } catch (err) {
    log.error('Error saat simpan subscriber:', err.message);
    return false;
  }
}

/**
 * Non-aktifkan subscriber (misal saat /stop atau /unsubscribe).
 * @param {string|number} chatId
 */
export async function unsubscribeSubscriber(chatId) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient
      .from('telegram_subscribers')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', String(chatId));

    if (error) {
      log.warn(`Gagal unsubscribe ${chatId}: ${error.message}`);
      return false;
    }

    log.info(`🔕 Subscriber berhasil dinonaktifkan: ${chatId}`);
    return true;
  } catch (err) {
    log.error('Error saat unsubscribe subscriber:', err.message);
    return false;
  }
}

/**
 * Ambil daftar seluruh subscriber aktif untuk broadcast.
 * @returns {Promise<Array<{ chat_id: string, username: string, first_name: string }>>}
 */
export async function getActiveSubscribers() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('telegram_subscribers')
      .select('chat_id, username, first_name, last_name')
      .eq('is_active', true);

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('does not exist')) {
        // Tabel belum dibuat di Supabase, return empty
        return [];
      }
      log.warn(`Gagal mengambil subscriber dari Supabase: ${error.message}`);
      return [];
    }

    return data || [];
  } catch (err) {
    log.error('Error saat mengambil subscriber:', err.message);
    return [];
  }
}

/**
 * Dapatkan total jumlah subscriber aktif.
 * @returns {Promise<number>}
 */
export async function getSubscriberCount() {
  if (!supabaseClient) return 0;
  try {
    const { count, error } = await supabaseClient
      .from('telegram_subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (error) return 0;
    return count || 0;
  } catch (err) {
    return 0;
  }
}

/**
 * Tandai subscriber non-aktif jika bot diblokir atau chat ID tidak valid.
 * @param {string|number} chatId
 */
export async function markSubscriberInactive(chatId) {
  return unsubscribeSubscriber(chatId);
}

