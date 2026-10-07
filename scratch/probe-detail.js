import axios from 'axios';
import xml2js from 'xml2js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9' };

for (const d of ['2026-10-06', '2026-10-07', '2026-10-08']) {
  const r = await axios.get(`https://api.nasdaq.com/api/calendar/economicevents?date=${d}`, { headers: H, timeout: 15000 });
  const rows = r.data?.data?.rows || [];
  console.log(`\nNASDAQ ${d} asOf=${r.data?.data?.asOf} total=${rows.length}`);
  rows.filter(x => /United States/i.test(x.country)).forEach(x => console.log('  ', JSON.stringify(x).slice(0, 220)));
}

const ff = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: H, timeout: 15000 });
console.log('\nFF USD:');
ff.data.filter(x => x.country === 'USD').forEach(x => console.log('  ', JSON.stringify(x)));

for (const url of ['https://investinglive.com/feed/', 'https://news.google.com/rss/search?q=(gold+OR+XAUUSD+OR+%22US+dollar%22+OR+Fed)+when:1d&hl=en-US&gl=US&ceid=US:en', 'https://www.investing.com/rss/news_14.rss']) {
  const r = await axios.get(url, { headers: H, timeout: 15000, responseType: 'text' });
  const p = await xml2js.parseStringPromise(r.data);
  const items = p?.rss?.channel?.[0]?.item || [];
  console.log(`\n${url} items=${items.length} keys=${Object.keys(items[0] || {}).join(',')}`);
  items.slice(0, 4).forEach(i => console.log('  ', i.pubDate?.[0], '|', String(i.title?.[0]).slice(0, 100), '|', typeof i.source?.[0] === 'object' ? i.source[0]._ : i.source?.[0]));
}
