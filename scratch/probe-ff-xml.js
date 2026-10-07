import axios from 'axios';
import xml2js from 'xml2js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/xml, text/xml, */*', 'Accept-Language': 'en-US,en;q=0.9' };

const targets = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
  'https://nfs.faireconomy.media/ff_news_thisweek.xml',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.xml',
];

for (const url of targets) {
  try {
    const res = await axios.get(url, { headers: H, timeout: 8000, responseType: 'text', validateStatus: () => true });
    console.log(`\n[${url}] ${res.status} len=${(res.data || '').length}`);
    if (res.status === 200 && res.data) {
      const parsed = await xml2js.parseStringPromise(res.data);
      const events = parsed?.weeklyevents?.event || [];
      console.log(`   Events count: ${events.length}`);
      const usdEvents = events.filter(e => e.country?.[0] === 'USD');
      console.log(`   USD Events count: ${usdEvents.length}`);
      usdEvents.slice(0, 3).forEach(e => console.log('   USD Sample:', JSON.stringify(e)));
    }
  } catch (err) {
    console.log(`[${url}] ERROR: ${err.message}`);
  }
}
