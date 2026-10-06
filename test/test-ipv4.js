import axios from 'axios';
import https from 'https';
import http from 'http';

const httpsAgent = new https.Agent({ family: 4, keepAlive: true });
const httpAgent = new http.Agent({ family: 4, keepAlive: true });

async function testIPv4() {
  console.log('⚡ Testing ForexFactory with forced IPv4 (family: 4)...');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    console.log('Fetching https://nodedata.forexfactory.com/forex/calendar/thisweek.json ...');
    const start = Date.now();
    const res = await axios.get('https://nodedata.forexfactory.com/forex/calendar/thisweek.json', {
      headers,
      httpsAgent,
      httpAgent,
      timeout: 10000,
    });
    const elapsed = Date.now() - start;
    console.log(`\n🎉 SUCCESS in ${elapsed}ms! Received ${res.data?.length} events.`);
    if (res.data?.length > 0) {
      console.log('Sample event:', res.data[0]);
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
  }
}

testIPv4();
