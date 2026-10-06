import axios from 'axios';

async function testDoH() {
  console.log('🔒 Resolving nodedata.forexfactory.com via Cloudflare DoH (DNS-over-HTTPS)...');

  try {
    const res = await axios.get('https://1.1.1.1/dns-query?name=nodedata.forexfactory.com', {
      headers: { 'Accept': 'application/dns-json' },
      timeout: 5000,
    });

    console.log('DoH Response:', res.data);
    const answers = res.data?.Answer || [];
    const realIPs = answers.filter(a => a.type === 1).map(a => a.data);
    console.log('Real IPs:', realIPs);

    if (realIPs.length > 0) {
      const realIP = realIPs[0];
      console.log(`Connecting directly to Real IP ${realIP} with Host header...`);

      const res2 = await axios.get(`https://${realIP}/forex/calendar/thisweek.json`, {
        headers: {
          'Host': 'nodedata.forexfactory.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        timeout: 10000,
      });

      console.log(`\n🎉 REALTIME SUCCESS! Received ${res2.data?.length} events directly from real IP!`);
      if (res2.data?.length > 0) {
        console.log('Sample Live Event:', res2.data[0]);
      }
    }
  } catch (err) {
    console.log('❌ DoH Error:', err.message);
  }
}

testDoH();
