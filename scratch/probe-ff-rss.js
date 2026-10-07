import axios from 'axios';
import xml2js from 'xml2js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/xml, text/xml, */*', 'Accept-Language': 'en-US,en;q=0.9' };

const targets = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
  'https://www.forexfactory.com/ff_calendar_thisweek.xml',
  'https://www.forexfactory.com/rss/news.xml',
  'https://www.forexfactory.com/rss/market.xml',
  'https://www.forexfactory.com/rss/calendar.xml',
];

for (const url of targets) {
  try {
    const t0 = Date.now();
    const res = await axios.get(url, { headers: H, timeout: 8000, responseType: 'text', validateStatus: () => true });
    console.log(`\n[${url}] ${res.status} ${Date.now() - t0}ms len=${(res.data || '').length}`);
    if (res.status === 200 && res.data) {
      try {
        const parsed = await xml2js.parseStringPromise(res.data);
        const items = parsed?.rss?.channel?.[0]?.item || parsed?.weeklyevents?.event || [];
        console.log(`   Parsed items/events count: ${items.length}`);
        if (items[0]) {
          console.log('   Sample item keys:', Object.keys(items[0]));
          console.log('   Sample item raw:', JSON.stringify(items[0]).slice(0, 300));
        }
      } catch (xmlErr) {
        console.log('   XML parse error:', xmlErr.message, 'head:', res.data.slice(0, 200));
      }
    }
  } catch (err) {
    console.log(`[${url}] ERROR: ${err.message}`);
  }
}
