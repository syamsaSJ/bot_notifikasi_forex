import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const schedule = require('node-schedule');
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Scheduler');

let scheduledJob = null;

/**
 * Mulai cron job untuk pengecekan berita.
 * @param {Function} taskFn - Fungsi yang akan dijalankan setiap interval
 * @returns {Object} - Scheduled job instance
 */
export function startScheduler(taskFn) {
  if (scheduledJob) {
    log.warn('Scheduler sudah berjalan, stop dulu sebelum start ulang');
    stopScheduler();
  }

  log.info(`Memulai scheduler dengan cron: "${config.CRON_EXPRESSION}"`);
  log.info('Jadwal: Setiap jam, Senin-Jumat, 07:00-23:00 WIB');

  scheduledJob = schedule.scheduleJob(config.CRON_EXPRESSION, async () => {
    const now = new Date().toLocaleString('id-ID', { timeZone: config.TIMEZONE });
    log.info(`[CRON] Job triggered at ${now}`);

    try {
      await taskFn();
      log.info('[CRON] Job completed successfully');
    } catch (err) {
      log.error('[CRON] Job failed:', err.message);
    }
  });

  if (scheduledJob) {
    const nextRun = scheduledJob.nextInvocation();
    log.info(`Next scheduled run: ${nextRun ? nextRun.toLocaleString('id-ID', { timeZone: config.TIMEZONE }) : 'N/A'}`);
  }

  return scheduledJob;
}

/**
 * Stop scheduler.
 */
export function stopScheduler() {
  if (scheduledJob) {
    scheduledJob.cancel();
    scheduledJob = null;
    log.info('Scheduler di-stop');
  }
}

/**
 * Dapatkan info next scheduled run.
 * @returns {string}
 */
export function getNextRun() {
  if (!scheduledJob) return 'Scheduler tidak aktif';
  const next = scheduledJob.nextInvocation();
  return next
    ? next.toLocaleString('id-ID', { timeZone: config.TIMEZONE })
    : 'Tidak ada jadwal berikutnya';
}
