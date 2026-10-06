import axios from 'axios';
import parseString from 'xml2js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { escapeMarkdown } from '../formatter/messageFormatter.js';
import { analyzeInvestingHeadline } from '../engine/signalEngine.js';

const log = createLogger('InvestingScraper');

let cache = {
  data: null,
  timestamp: 0,
};

const INVESTING_FEEDS = [
  { name: 'Forex', url: 'https://www.investing.com/rss/forex.rss' },
  { name: 'Indikator Ekonomi', url: 'https://www.investing.com/rss/news_14.rss' },
  { name: 'Komoditas & Emas', url: 'https://www.investing.com/rss/news_11.rss' },
  { name: 'Market Overview', url: 'https://www.investing.com/rss/market_overview.rss' },
];

function getHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
}

function parseXmlPromise(xmlData) {
  return new Promise((resolve, reject) => {
    parseString.parseString(xmlData, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Ambil berita pasar & kalender indikator dari Investing.com via RSS Feeds.
 * @returns {Promise<Array<Object>>}
 */
export async function getInvestingNews() {
  const now = Date.now();
  if (cache.data && (now - cache.timestamp) < config.CACHE_TTL_MS) {
    log.info('Menggunakan berita Investing.com dari cache');
    return cache.data;
  }

  log.info('🌐 Mengambil berita & indikator dari Investing.com RSS Feeds...');
  const allNews = [];

  for (const feed of INVESTING_FEEDS) {
    try {
      const res = await axios.get(feed.url, { headers: getHeaders(), timeout: 8000 });
      if (res.status === 200 && res.data) {
        const parsed = await parseXmlPromise(res.data);
        const items = parsed?.rss?.channel?.[0]?.item || [];

        items.forEach(item => {
          const rawDate = item.pubDate?.[0] || '';
          let dateObj = new Date(rawDate);
          if (isNaN(dateObj.getTime())) dateObj = new Date();

          const timeWIB = dateObj.toLocaleTimeString('id-ID', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
          }) + ' WIB';

          const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
          const dayName = dayNames[dateObj.getDay()];
          const dayNum = dateObj.getDate();
          const timeDisplay = `${dayName}, ${dayNum} • ${timeWIB}`;

          const title = item.title?.[0] || 'Investing.com News';
          const analysis = analyzeInvestingHeadline(title, feed.name);

          allNews.push({
            title,
            link: item.link?.[0] || 'https://www.investing.com',
            pubDate: rawDate,
            timeWIB: timeDisplay,
            category: feed.name,
            source: 'Investing.com',
            analysis,
          });
        });
      }
    } catch (err) {
      log.warn(`Gagal mengambil RSS Investing.com (${feed.name}): ${err.message}`);
    }
  }

  log.info(`✅ Berhasil memperoleh ${allNews.length} berita/indikator dari Investing.com`);
  cache.data = allNews;
  cache.timestamp = now;
  return allNews;
}

/**
 * Format berita Investing.com ke format Markdown Telegram.
 * @param {Array<Object>} newsItems 
 * @returns {string}
 */
export function formatInvestingSummary(newsItems) {
  if (!newsItems || newsItems.length === 0) {
    return `📰 *BERITA & INDIKATOR INVESTING.COM*
━━━━━━━━━━━━━━━━━━━━━━━━

❌ Tidak ada berita Investing.com yang tersedia saat ini\\.`;
  }

  let msg = `📰 *BERITA & ANALISIS PASAR INVESTING.COM*
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const topNews = newsItems.slice(0, 6);
  topNews.forEach((item, index) => {
    const analysis = item.analysis || analyzeInvestingHeadline(item.title || '', item.category || '');
    const sigEmoji = analysis.signal === 'BUY' ? '🟢 BUY' : analysis.signal === 'SELL' ? '🔴 SELL' : '⚪ NEUTRAL';
    msg += `${index + 1}\\. *[${escapeMarkdown(item.category)}]* ${escapeMarkdown(item.title)}\n`;
    msg += `   📊 *Sinyal Impact:* ${sigEmoji} \\| ${escapeMarkdown(analysis.direction)}\n`;
    msg += `   ⏰ ${escapeMarkdown(item.timeWIB)} • _Investing\\.com_\n\n`;
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━
_Sumber: Investing\\.com RSS Feeds_`;

  return msg;
}
