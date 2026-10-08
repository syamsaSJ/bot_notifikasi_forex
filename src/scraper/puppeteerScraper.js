import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createLogger } from '../utils/logger.js';
import { parseCalendarHTML, filterHighImpact } from './parser.js';

// Tambahkan stealth plugin untuk membypass Cloudflare
puppeteer.use(StealthPlugin());

const log = createLogger('PuppeteerScraper');

let browserInstance = null;
let pageInstance = null;

/**
 * Inisialisasi headless browser agar tidak perlu buka tutup browser terus menerus (lebih hemat resource)
 */
export async function initBrowser() {
  if (browserInstance) return browserInstance;
  
  log.info('🚀 Menginisialisasi Puppeteer Stealth Browser...');
  try {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
      ],
      defaultViewport: { width: 1920, height: 1080 },
    });

    pageInstance = await browserInstance.newPage();
    
    // Set custom user agent & block images/fonts to speed up scraping
    await pageInstance.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await pageInstance.setRequestInterception(true);
    pageInstance.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    log.info('✅ Puppeteer Browser berhasil diinisialisasi.');
    return browserInstance;
  } catch (err) {
    log.error('❌ Gagal inisialisasi Puppeteer:', err.message);
    return null;
  }
}

/**
 * Tutup browser jika aplikasi dimatikan
 */
export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    pageInstance = null;
    log.info('Browser ditutup.');
  }
}

/**
 * Scrape langsung kalender Forex Factory untuk mendapatkan nilai 'Actual'
 * Bypass Cloudflare secara real-time.
 */
export async function scrapeLiveCalendarWithPuppeteer() {
  if (!browserInstance || !pageInstance) {
    await initBrowser();
  }

  if (!pageInstance) {
    log.warn('Browser tidak tersedia, fallback ke array kosong.');
    return [];
  }

  try {
    log.info('🌐 [Puppeteer] Navigating to forexfactory.com/calendar...');
    
    // Buka halaman kalender
    await pageInstance.goto('https://www.forexfactory.com/calendar', {
      waitUntil: 'domcontentloaded', // Tunggu sampai DOM terbentuk
      timeout: 30000,
    });

    // Tunggu sedikit supaya AJAX atau websocket dari FF memuat data "actual"
    await new Promise(resolve => setTimeout(resolve, 2000)); 

    // Ambil full HTML dari body
    const htmlContent = await pageInstance.content();
    
    log.info('✅ [Puppeteer] HTML berhasil ditarik, mulai parsing...');

    // Gunakan parser bawaan (cheerio) untuk mengurai HTML menjadi array event
    const events = parseCalendarHTML(htmlContent);
    
    log.info(`📊 [Puppeteer] Berhasil parsing ${events.length} event USD hari ini.`);
    return events;
    
  } catch (err) {
    log.error('❌ [Puppeteer] Error saat scraping halaman:', err.message);
    
    // Jika ada error krusial (seperti browser crash), kita restart instance
    if (err.message.includes('Session closed') || err.message.includes('Target closed')) {
       await closeBrowser();
    }
    
    return [];
  }
}
