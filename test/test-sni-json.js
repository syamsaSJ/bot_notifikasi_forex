import axios from 'axios';
import https from 'https';

async function testSNIJSON() {
  console.log('🔒 Testing Cloudflare Direct IP connection for JSON API...');

  const ip = '104.18.6.7';
  const host = 'nodedata.forexfactory.com';

  const agent = new https.Agent({
    servername: host,
    rejectUnauthorized: false,
  });

  try {
    const res = await axios.get(`https://${ip}/forex/calendar/thisweek.json`, {
      headers: {
        'Host': host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
      httpsAgent: agent,
      timeout: 10000,
    });

    console.log(`\n🎉 REALTIME LIVE JSON SUCCESS! Received ${res.data?.length} events directly via Cloudflare SNI IP!`);
    if (res.data?.length > 0) {
      console.log('Sample Live Event:', res.data[0]);
    }
  } catch (err) {
    console.log('❌ SNI JSON Error:', err.message);
  }
}

testSNIJSON();
