import axios from 'axios';
import * as cheerio from 'cheerio';

async function probeProxyNews() {
  const proxies = [
    'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.forexfactory.com/news'),
    'https://corsproxy.io/?url=' + encodeURIComponent('https://www.forexfactory.com/news'),
    'https://www.forexfactory.com/news',
  ];

  for (const p of proxies) {
    try {
      console.log(`Testing proxy: ${p.slice(0, 60)}...`);
      const res = await axios.get(p, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 10000,
        responseType: 'text',
      });
      console.log(`Status: ${res.status}, Length: ${res.data.length}`);
      const $ = cheerio.load(res.data);
      const newsItems = [];
      $('.flexitems__item, .news__item, tr.news__row, .flexbox__item').each((i, el) => {
        const title = $(el).find('.flexitems__title, .news__title, a.title, .flexbox__title').text().trim();
        const link = $(el).find('a').attr('href');
        if (title) {
          newsItems.push({ title, link });
        }
      });
      console.log(`Found ${newsItems.length} cheerio items.`);
      if (newsItems.length > 0) {
        console.log('Sample news item:', newsItems[0]);
        return;
      } else {
        // Find any <a> tags containing news titles
        const titles = [];
        $('a').each((i, el) => {
          const text = $(el).text().trim();
          const href = $(el).attr('href') || '';
          if (href.includes('/news/') && text.length > 15) {
            titles.push({ text, href });
          }
        });
        console.log(`Found ${titles.length} news <a> titles:`);
        if (titles.length > 0) {
          console.log(titles.slice(0, 5));
          return;
        }
      }
    } catch (err) {
      console.log('Failed:', err.message);
    }
  }
}

probeProxyNews().catch(console.error);
