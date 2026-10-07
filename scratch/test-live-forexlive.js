import { getUnifiedFeed } from '../src/scraper/unifiedFeed.js';

async function testLive() {
  console.log('Testing live fetch...');
  const items = await getUnifiedFeed(true);
  console.log(`Received ${items.length} total items in feed.`);
  
  const forexLiveItems = items.filter(i => i.source === 'ForexLive');
  console.log(`ForexLive items count: ${forexLiveItems.length}`);
  
  if (forexLiveItems.length > 0) {
    console.log('Sample ForexLive item:');
    console.log(forexLiveItems[0]);
  }

  const calendarItems = items.filter(i => i.source === 'Forex Factory');
  console.log(`Forex Factory calendar items count: ${calendarItems.length}`);
  if (calendarItems.length > 0) {
    console.log('Sample Calendar item:');
    console.log(calendarItems[0]);
  }
}

testLive().catch(console.error);
