import dotenv from 'dotenv';
dotenv.config();

export default {
  // Telegram Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  // Timezone
  TIMEZONE: process.env.TIMEZONE || 'Asia/Jakarta',

  // Forex Factory
  FOREX_FACTORY_URL: 'https://www.forexfactory.com/calendar',
  
  // Scraper settings
  SCRAPE_TIMEOUT_MS: 15000,
  SCRAPE_RETRY_COUNT: 3,
  SCRAPE_RETRY_DELAY_MS: 2000,
  CACHE_TTL_MS: 30 * 60 * 1000, // 30 menit

  // Cron: setiap jam, Senin-Jumat, 00:00-16:00 UTC (07:00-23:00 WIB)
  CRON_EXPRESSION: process.env.CRON_EXPRESSION || '0 0-16 * * 1-5',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  NODE_ENV: process.env.NODE_ENV || 'development',

  // User-Agent rotation pool
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  ],
};
