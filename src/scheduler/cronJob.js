import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const schedule = require('node-schedule');
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Scheduler');

let scheduledJob = null;

/**
 * Mulai cron job untuk pengecekan berita realtime.
 * @param {Function} taskFn - Fungsi yang akan dijalankan setiap interval (1 menit)
 * @returns {Object} - Scheduled job instance
 */
export function startScheduler(taskFn) {
  if (scheduledJob) {
    log.warn('Scheduler sudah berjalan, stop dulu sebelum start ulang');
    stopScheduler();
  }

  log.info(`Memulai scheduler realtime dengan cron: "${config.CRON_EXPRESSION}"`);
  log.info('Jadwal Polling: Setiap 1 Menit (Senin-Jumat)');

  scheduledJob = schedule.scheduleJob(config.CRON_EXPRESSION, async () => {
    const now = new Date().toLocaleString('id-ID', { timeZone: config.TIMEZONE });
    log.debug(`[CRON] Realtime check triggered at ${now}`);

    try {
      await taskFn();
    } catch (err) {
      log.error('[CRON] Realtime check error:', err.message);
    }
  });

  if (scheduledJob) {
    const nextRun = scheduledJob.nextInvocation();
    log.info(`Next scheduled check: ${nextRun ? nextRun.toLocaleString('id-ID', { timeZone: config.TIMEZONE }) : 'N/A'}`);
  }

  return scheduledJob;
}

export function stopScheduler() {
  if (scheduledJob) {
    scheduledJob.cancel();
    scheduledJob = null;
    log.info('Scheduler di-stop');
  }
}

export function getNextRun() {
  if (!scheduledJob) return 'Scheduler tidak aktif';
  const next = scheduledJob.nextInvocation();
  return next
    ? next.toLocaleString('id-ID', { timeZone: config.TIMEZONE })
    : 'Tidak ada jadwal berikutnya';
}
