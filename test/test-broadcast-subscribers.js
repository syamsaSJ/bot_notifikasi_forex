import config from '../src/utils/config.js';
import { getBroadcastChatIds } from '../src/bot/telegram.js';
import { getActiveSubscribers, getSubscriberCount } from '../src/services/supabaseService.js';

async function run() {
  console.log('1. Testing Subscriber & Broadcast logic...');
  console.log('2. Current config.TELEGRAM_CHAT_ID:', config.TELEGRAM_CHAT_ID);

  console.log('3. Fetching broadcast targets...');
  const targets = await getBroadcastChatIds();
  console.log('4. Broadcast targets identified:', targets);

  console.log('5. Fetching count...');
  const count = await getSubscriberCount();
  console.log('6. Active Supabase subscribers count:', count);

  console.log('7. Fetching list...');
  const subs = await getActiveSubscribers();
  console.log('8. Active Supabase subscribers list:', subs);

  const { getTodayReleaseScheduleInfo } = await import('../src/scraper/apifyCalendar.js');
  const todayWIBStr = new Date().toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE || 'Asia/Jakarta' });
  const sampleEvents = [
    {
      itemType: 'calendar',
      currency: 'USD',
      date: todayWIBStr,
      time: '19:30 WIB',
      timestamp: Date.now() + 60000,
      actual: '-',
      forecast: '200K',
      previous: '190K',
      event: 'Core CPI m/m',
    }
  ];
  const info = getTodayReleaseScheduleInfo(sampleEvents);
  console.log('9. Sample slot triggerTimeWIB:', info.slots[0]?.triggerTimeWIB);
  console.log('10. Sample slot cronExpression:', info.slots[0]?.cronExpression);
  console.log('11. nextCronExpression:', info.nextCronExpression);

  if (targets.includes(String(config.TELEGRAM_CHAT_ID))) {
    console.log('SUCCESS: Primary TELEGRAM_CHAT_ID is included in broadcast targets.');
  } else {
    console.error('FAILED: Primary TELEGRAM_CHAT_ID missing from targets.');
  }
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
