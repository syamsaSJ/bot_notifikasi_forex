import axios from 'axios';
import xml2js from 'xml2js';

async function probeFFNews() {
  console.log('Probing Forex Factory News RSS & Web...');
  const urls = [
    'https://nfs.faireconomy.media/ff_news_thisweek.xml',
    'https://www.forexfactory.com/news.xml',
    'https://www.forexfactory.com/news',
  ];

  for (const u of urls) {
    try {
      console.log(`\nFetching ${u}...`);
      const res = await axios.get(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 8000,
        responseType: 'text',
      });
      console.log(`Status: ${res.status}, Length: ${res.data.length}`);
      if (u.endsWith('.xml')) {
        const parsed = await xml2js.parseStringPromise(res.data);
        console.log('Parsed XML keys:', Object.keys(parsed));
        const items = parsed?.rss?.channel?.[0]?.item || parsed?.news?.story || parsed?.weeklynews?.news || [];
        console.log(`Found ${items.length} items.`);
        if (items.length > 0) {
          console.log('Sample item:', items[0]);
        }
      } else {
        console.log('HTML Snippet:', res.data.slice(0, 500));
      }
    } catch (err) {
      console.log(`Failed ${u}:`, err.message);
    }
  }
}

probeFFNews().catch(console.error);
