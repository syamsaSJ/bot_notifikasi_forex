import axios from 'axios';
import xml2js from 'xml2js';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' };
const ids = ['news_1', 'news_11', 'news_95', 'news_285', '121899', '302', '1061', '1062', '1064', 'analysis', 'forex', 'commodities', 'market_overview'];
for (const id of ids) {
  const url = `https://www.investing.com/rss/${id}.rss`;
  try {
    const r = await axios.get(url, { headers: H, timeout: 8000, responseType: 'text', validateStatus: () => true });
    let title = '', n = 0, first = '';
    try {
      const p = await xml2js.parseStringPromise(r.data);
      title = p?.rss?.channel?.[0]?.title?.[0];
      const items = p?.rss?.channel?.[0]?.item || [];
      n = items.length; first = items[0] ? `${items[0].pubDate?.[0]} | ${items[0].title?.[0]}` : '';
    } catch {}
    console.log(`${id}: ${r.status} "${title}" n=${n} :: ${String(first).slice(0, 110)}`);
  } catch (e) { console.log(id, 'ERR', e.message); }
}
