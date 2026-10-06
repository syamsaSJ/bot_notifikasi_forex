import axios from 'axios';
import https from 'https';

async function testDoH2() {
  console.log('🔒 Resolving www.forexfactory.com via Cloudflare DoH...');

  try {
    const res = await axios.get('https://1.1.1.1/dns-query?name=www.forexfactory.com', {
      headers: { 'Accept': 'application/dns-json' },
      timeout: 5000,
    });

    const answers = res.data?.Answer || [];
    console.log('DoH Answers for www.forexfactory.com:', answers);

    const ip = answers.find(a => a.type === 1)?.data;
    if (ip) {
      console.log(`Connecting directly to Cloudflare IP ${ip} for ForexFactory...`);

      const agent = new https.Agent({ rejectUnauthorized: false });

      const res2 = await axios.get(`https://${ip}/calendar?day=today`, {
        headers: {
          'Host': 'www.forexfactory.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        httpsAgent: agent,
        timeout: 10000,
      });

      console.log(`\n🎉 REALTIME LIVE SCRAPING SUCCESS! Received ${res2.data?.length} bytes directly from Cloudflare IP ${ip}!`);
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
  }
}

testDoH2();
