import dotenv from 'dotenv';
dotenv.config();

export default {
  // Telegram Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  // News & AI APIs
  NEWSDATA_API_KEY: process.env.NEWSDATA_API_KEY || '',
  GNEWS_API_KEY: process.env.GNEWS_API_KEY || '',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',

  // Timezone (default: Asia/Jakarta = WIB)
  TIMEZONE: process.env.TIMEZONE || 'Asia/Jakarta',

  // Forex Factory URL
  FOREX_FACTORY_URL: 'https://www.forexfactory.com/calendar',

  // Scraper settings
  SCRAPE_TIMEOUT_MS: 15000,
  SCRAPE_RETRY_COUNT: 3,
  SCRAPE_RETRY_DELAY_MS: 2000,
  CACHE_TTL_MS: 1 * 60 * 1000, // 1 menit

  // Cron: Setiap 1 menit, Senin-Jumat
  CRON_EXPRESSION: process.env.CRON_EXPRESSION || '* * * * 1-5',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  NODE_ENV: process.env.NODE_ENV || 'development',

  // User-Agent rotation pool
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ],
};
