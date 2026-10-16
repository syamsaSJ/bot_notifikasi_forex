const { join } = require('path');

/**
 * Konfigurasi Puppeteer untuk Render & Production Hosting.
 * Memaksa Puppeteer menyimpan binary Chrome di dalam folder proyek (.cache/puppeteer)
 * agar tersimpan permanen saat container Render beralih dari fase Build ke fase Runtime.
 *
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
