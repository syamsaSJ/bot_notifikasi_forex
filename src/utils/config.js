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

  // Supabase Database Configuration
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Apify Configuration (Silentflow Forex Factory Scraper)
  APIFY_TOKEN: process.env.APIFY_TOKEN || '',
  APIFY_ACTOR_ID: process.env.APIFY_ACTOR_ID || 'silentflow/forexfactory-scraper',
  APIFY_CACHE_TTL_MS: parseInt(process.env.APIFY_CACHE_TTL_MS, 10) || 1 * 60 * 1000,




  // RapidAPI - Forex Factory Scraper (sumber utama kalender ekonomi realtime)
  RAPIDAPI_KEY: process.env.RAPIDAPI_KEY || '',
  RAPIDAPI_FF_HOST: process.env.RAPIDAPI_FF_HOST || 'forex-factory-scraper1.p.rapidapi.com',
  // Refresh jadwal berkala (default 6 jam) - hemat kuota
  RAPIDAPI_CALENDAR_TTL_MS: parseInt(process.env.RAPIDAPI_CALENDAR_TTL_MS, 10) || 6 * 60 * 60 * 1000,
  // Jeda minimal antar request RapidAPI (default 2 menit)
  RAPIDAPI_MIN_INTERVAL_MS: parseInt(process.env.RAPIDAPI_MIN_INTERVAL_MS, 10) || 2 * 60 * 1000,
  // Tunggu setelah jam rilis sebelum fetch 'actual' (default 45 detik)
  RAPIDAPI_RELEASE_DELAY_MS: parseInt(process.env.RAPIDAPI_RELEASE_DELAY_MS, 10) || 45 * 1000,
  // Batas waktu menunggu 'actual' setelah jam rilis (default 10 menit)
  RAPIDAPI_RELEASE_WINDOW_MS: parseInt(process.env.RAPIDAPI_RELEASE_WINDOW_MS, 10) || 10 * 60 * 1000,

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
