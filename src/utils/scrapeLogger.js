import fs from 'fs';
import path from 'path';
import config from './config.js';

const LOG_FILE = path.resolve('scratch', 'scrape_errors.log');
const MAX_MEMORY_LOGS = 50;

// In-memory buffer for fast access via API and Telegram
const memoryLogs = [];
const sourceHealthStatus = {};

/**
 * Log scraping result/attempt.
 * @param {string} source - Name of source (e.g. 'ForexFactory', 'InvestingRSS', 'Nasdaq')
 * @param {boolean} success - Whether fetch succeeded
 * @param {number} itemCount - Number of items retrieved
 * @param {string|null} errorMsg - Error message if failed
 */
export function logScrapeResult(source, success, itemCount = 0, errorMsg = null) {
  const timestamp = new Date().toISOString();
  const timeWIB = new Date().toLocaleString('id-ID', { timeZone: config.TIMEZONE });

  sourceHealthStatus[source] = {
    lastCheck: timestamp,
    lastCheckWIB: timeWIB,
    status: success ? 'OK' : 'ERROR',
    itemCount: success ? itemCount : 0,
    lastError: errorMsg || null,
  };

  const entry = {
    id: Date.now() + Math.random().toString(36).substr(2, 4),
    timestamp,
    timeWIB,
    source,
    success,
    itemCount,
    error: errorMsg || null,
  };

  memoryLogs.unshift(entry);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.pop();
  }

  // Write error logs to disk
  if (!success && errorMsg) {
    try {
      const dir = path.dirname(LOG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const logLine = `[${timeWIB}] [${source}] ERROR: ${errorMsg}\n`;
      fs.appendFileSync(LOG_FILE, logLine, 'utf-8');
    } catch (e) {
      console.error('Failed to write scrape error log to file:', e.message);
    }
  }
}

/**
 * Get recent scraping logs.
 */
export function getScrapeLogs(limit = 20) {
  return memoryLogs.slice(0, limit);
}

/**
 * Get overall health status of all sources.
 */
export function getSourceHealth() {
  return sourceHealthStatus;
}

/**
 * Format scrape health and error logs for Telegram /logs command.
 */
export function formatLogsTelegram() {
  const healthKeys = Object.keys(sourceHealthStatus);
  let msg = `📋 *STATUS & LOG SCRAPING REALTIME*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (healthKeys.length === 0) {
    msg += `ℹ️ Belum ada aktivitas scraping yang terekam\\.\n\n`;
  } else {
    msg += `🌐 *Status Sumber Data:*\n`;
    for (const key of healthKeys) {
      const s = sourceHealthStatus[key];
      const icon = s.status === 'OK' ? '✅' : '❌';
      const errText = s.lastError ? ` (${escapeTg(s.lastError.slice(0, 40))})` : '';
      msg += `${icon} *${escapeTg(key)}*: ${s.status} \\| ${s.itemCount} items${errText}\n`;
      msg += `   🕒 _Cek Terakhir: ${escapeTg(s.lastCheckWIB)}_\n`;
    }
    msg += `\n`;
  }

  const errors = memoryLogs.filter(l => !l.success);
  msg += `⚠️ *5 Log Error Terakhir:*\n`;

  if (errors.length === 0) {
    msg += `✅ Tidak ada error scraping tercatat\\.\n`;
  } else {
    errors.slice(0, 5).forEach((err, idx) => {
      msg += `${idx + 1}\\. [${escapeTg(err.source)}] ${escapeTg(err.error || 'Unknown Error')}\n`;
      msg += `   🕒 _${escapeTg(err.timeWIB)}_\n`;
    });
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n_Log File: scratch/scrape_errors.log_`;
  return msg;
}

function escapeTg(text) {
  if (!text) return '';
  return text.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
