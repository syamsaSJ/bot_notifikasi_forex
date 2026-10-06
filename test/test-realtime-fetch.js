import { getHighImpactNews, clearCache } from '../src/scraper/forexFactory.js';

async function testRealtimeFetch() {
  console.log('📡 Testing Realtime Live Scraping/API...');
  clearCache();

  const events = await getHighImpactNews();
  console.log(`\n🎉 Total Live Events Fetched: ${events.length}`);

  if (events.length > 0) {
    console.log('\n--- SAMPLE LIVE EVENT ---');
    console.log(JSON.stringify(events[0], null, 2));
  } else {
    console.log('ℹ️ Tidak ada berita USD (High/Medium) pada jadwal saat ini.');
  }
}

testRealtimeFetch().catch(err => {
  console.error('❌ Error during live fetch:', err);
  process.exit(1);
});
