import axios from 'axios';
import xml2js from 'xml2js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/xml, text/xml, */*' };

const targets = [
  'https://www.forexlive.com/feed/news',
  'https://www.forexlive.com/feed/',
  'https://investinglive.com/feed/',
];

for (const url of targets) {
  try {
    const res = await axios.get(url, { headers: H, timeout: 8000, responseType: 'text' });
    console.log(`\n[${url}] Status: ${res.status} Length: ${res.data.length}`);
    if (res.status === 200 && res.data) {
      const parsed = await xml2js.parseStringPromise(res.data);
      const items = parsed?.rss?.channel?.[0]?.item || [];
      console.log(`   Items count: ${items.length}`);
      if (items[0]) {
        console.log('   Sample title:', items[0].title?.[0]);
        console.log('   Sample pubDate:', items[0].pubDate?.[0]);
        console.log('   Sample link:', items[0].link?.[0]);
      }
    }
  } catch (e) {
    console.log(`[${url}] Error: ${e.message}`);
  }
}
