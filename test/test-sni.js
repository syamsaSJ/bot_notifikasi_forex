import axios from 'axios';
import https from 'https';

async function testSNI() {
  console.log('🔒 Testing Cloudflare Direct IP connection with TLS SNI passthrough...');

  const ip = '104.18.6.7';
  const host = 'www.forexfactory.com';

  const agent = new https.Agent({
    servername: host,
    rejectUnauthorized: false,
  });

  try {
    const res = await axios.get(`https://${ip}/calendar?day=today`, {
      headers: {
        'Host': host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      httpsAgent: agent,
      timeout: 10000,
    });

    console.log(`\n🎉 REALTIME LIVE SCRAPING BINGO! Received ${res.data?.length} bytes from ForexFactory via SNI Direct IP!`);
  } catch (err) {
    console.log('❌ SNI Test Error:', err.message);
  }
}

testSNI();
