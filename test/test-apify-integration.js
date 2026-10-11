import { isApifyConfigured, fetchApifyCalendar } from '../src/scraper/apifyCalendar.js';
import { getHighImpactNews } from '../src/scraper/forexFactory.js';
import { getUnifiedFeed } from '../src/scraper/unifiedFeed.js';

async function testApifyIntegration() {
  console.log('🧪 Testing Apify Integration...');
  console.log(`Is Apify Configured: ${isApifyConfigured()}`);

  if (!isApifyConfigured()) {
    console.error('❌ Apify token is not configured!');
    process.exit(1);
  }

  console.log('\n--- 1. Testing Direct fetchApifyCalendar() ---');
  try {
    const apifyItems = await fetchApifyCalendar({ forceRefresh: true });
    console.log(`Fetched ${apifyItems.length} items directly from Apify.`);
    if (apifyItems.length > 0) {
      console.log('Sample Apify event:');
      console.log(JSON.stringify(apifyItems[0], null, 2));
    }
  } catch (err) {
    console.error('Error fetching direct Apify calendar:', err);
  }

  console.log('\n--- 2. Testing getHighImpactNews() with Apify ---');
  try {
    const highImpact = await getHighImpactNews();
    console.log(`getHighImpactNews returned ${highImpact.length} events.`);
    const apifyCount = highImpact.filter(item => item.source && item.source.includes('Apify')).length;
    console.log(`Events sourced directly from Apify: ${apifyCount}`);
  } catch (err) {
    console.error('Error in getHighImpactNews:', err);
  }

  console.log('\n--- 3. Testing getUnifiedFeed() with Apify ---');
  try {
    const feed = await getUnifiedFeed(true);
    console.log(`getUnifiedFeed returned ${feed.length} total items.`);
    const calendarEvents = feed.filter(i => i.itemType === 'calendar');
    console.log(`Calendar items in feed: ${calendarEvents.length}`);
  } catch (err) {
    console.error('Error in getUnifiedFeed:', err);
  }

  console.log('\n✅ Apify Integration Test Completed Successfully!');
}

testApifyIntegration().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
