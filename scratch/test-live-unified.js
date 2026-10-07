import { getUnifiedFeed } from '../src/scraper/unifiedFeed.js';
import { getScrapeLogs, getSourceHealth } from '../src/utils/scrapeLogger.js';

console.log('Testing Live Unified Feed Fetch...');
const items = await getUnifiedFeed(true);
console.log(`Total items retrieved: ${items.length}`);

console.log('\nTop 5 Items:');
items.slice(0, 5).forEach((item, idx) => {
  console.log(`${idx + 1}. [${item.source}] [${item.itemType}] ${item.timeWIB}`);
  console.log(`   Title: ${item.title || item.event}`);
  console.log(`   Signal: ${item.signal?.signal} (${item.signal?.direction || ''})`);
});

console.log('\nSource Health Status:');
console.dir(getSourceHealth(), { depth: null });

process.exit(0);
