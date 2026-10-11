import { getUnifiedFeed } from '../src/scraper/unifiedFeed.js';

async function testUnifiedFeedWithTradingView() {
  console.log('=== TESTING UNIFIED FEED WITH TRADINGVIEW NEWS ===\n');

  try {
    const feed = await getUnifiedFeed(true, 'realtime');
    console.log(`Total feed items fetched: ${feed.length}`);

    const tvItems = feed.filter(item => item.source && item.source.toLowerCase().includes('tradingview'));
    console.log(`TradingView items after strict filtering: ${tvItems.length}`);

    if (tvItems.length > 0) {
      console.log('\nSample TradingView News Item:');
      console.log({
        id: tvItems[0].id,
        source: tvItems[0].source,
        title: tvItems[0].title,
        timeWIB: tvItems[0].timeWIB,
        signal: tvItems[0].signal,
        link: tvItems[0].link
      });
    }

    console.log('\n=== TEST COMPLETED SUCCESSFULLY ===');
  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  }
}

testUnifiedFeedWithTradingView();
