import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TelegramBot = require('node-telegram-bot-api');
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import {
  isSupabaseConfigured,
  getActiveSubscribers,
  markSubscriberInactive,
} from '../services/supabaseService.js';

const log = createLogger('TelegramBot');

let bot = null;

export function initBot() {
  if (!config.TELEGRAM_BOT_TOKEN) {
    log.error('TELEGRAM_BOT_TOKEN tidak ditemukan di .env!');
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });

  bot.on('polling_error', (err) => {
    log.error('Polling error:', err.message);
  });

  log.info('Telegram Bot berhasil diinisialisasi');
  return bot;
}

/**
 * Mengambil seluruh Chat ID tujuan broadcast (dari .env dan dari Supabase subscribers)
 * @returns {Promise<string[]>}
 */
export async function getBroadcastChatIds() {
  const targets = new Set();

  // 1. Ambil dari .env (bisa 1 ID atau dipisah koma)
  if (config.TELEGRAM_CHAT_ID) {
    const envIds = config.TELEGRAM_CHAT_ID
      .toString()
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    envIds.forEach(id => targets.add(id));
  }

  // 2. Ambil dari database Supabase (pelanggan yang ketik /start)
  if (isSupabaseConfigured()) {
    try {
      const subs = await getActiveSubscribers();
      if (Array.isArray(subs)) {
        subs.forEach(sub => {
          if (sub.chat_id) targets.add(String(sub.chat_id).trim());
        });
      }
    } catch (err) {
      log.warn(`Gagal mengambil subscriber database: ${err.message}`);
    }
  }

  return Array.from(targets);
}

/**
 * Cek apakah error disebabkan user memblokir bot atau akun sudah dihapus
 */
function isUserBlockedOrDeadError(errMsg = '') {
  const lower = errMsg.toLowerCase();
  return (
    lower.includes('bot was blocked by the user') ||
    lower.includes('chat not found') ||
    lower.includes('user is deactivated') ||
    lower.includes('bot is not a member') ||
    lower.includes('chat_write_forbidden')
  );
}

/**
 * Kirim pesan ke 1 target Chat ID
 */
async function sendSingleMessage(targetChatId, message) {
  if (!bot) throw new Error('Bot belum diinisialisasi');

  try {
    const result = await bot.sendMessage(targetChatId, message, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    });
    return result;
  } catch (err) {
    if (err.message?.includes('parse') || err.message?.includes('markdown')) {
      log.warn(`MarkdownV2 gagal ke ${targetChatId}, fallback plain text...`);
      try {
        const plainText = message
          .replace(/\\([_\[\]()~`>#+\-=|{}.!\\])/g, '$1')
          .replace(/\*/g, '')
          .replace(/`{3}[\s\S]*?`{3}/g, (match) => match.replace(/`/g, ''));

        const result = await bot.sendMessage(targetChatId, plainText);
        return result;
      } catch (fallbackErr) {
        log.error(`Gagal plain text ke ${targetChatId}:`, fallbackErr.message);
        if (isUserBlockedOrDeadError(fallbackErr.message)) {
          await markSubscriberInactive(targetChatId).catch(() => {});
        }
        throw fallbackErr;
      }
    }

    if (isUserBlockedOrDeadError(err.message)) {
      log.warn(`Chat ${targetChatId} memblokir bot / tidak aktif. Menandai inactive...`);
      await markSubscriberInactive(targetChatId).catch(() => {});
    }

    log.error(`Gagal kirim pesan ke ${targetChatId}:`, err.message);
    throw err;
  }
}

/**
 * Kirim pesan teks.
 * Jika chatId diisi: kirim ke chat tersebut saja.
 * Jika chatId kosong: broadcast ke seluruh subscriber Supabase & .env.
 */
export async function sendMessage(message, chatId) {
  if (!bot) {
    throw new Error('Bot belum diinisialisasi. Panggil initBot() terlebih dahulu.');
  }

  // Mode kirim ke 1 chat spesifik
  if (chatId) {
    const result = await sendSingleMessage(String(chatId), message);
    log.info(`Pesan terkirim ke chat ${chatId}`);
    return result;
  }

  // Mode broadcast ke seluruh subscriber
  const targetIds = await getBroadcastChatIds();

  if (targetIds.length === 0) {
    log.error('Tidak ada Chat ID penerima! Isi TELEGRAM_CHAT_ID di .env atau pastikan ada subscriber di Supabase.');
    return null;
  }

  log.info(`📡 Memulai broadcast pesan ke ${targetIds.length} penerima...`);
  let successCount = 0;
  let failCount = 0;

  for (const id of targetIds) {
    try {
      await sendSingleMessage(id, message);
      successCount++;
    } catch (e) {
      failCount++;
    }
    // Delay 80ms untuk mencegah Telegram flood limit (max 30 req/sec)
    if (targetIds.length > 1) {
      await new Promise(r => setTimeout(r, 80));
    }
  }

  log.info(`📡 Broadcast selesai: ${successCount} berhasil, ${failCount} gagal (Total ${targetIds.length})`);
  return { successCount, failCount, total: targetIds.length };
}

/**
 * Kirim foto ke 1 target Chat ID
 */
async function sendSinglePhoto(targetChatId, imageBuffer, caption) {
  if (!bot) throw new Error('Bot belum diinisialisasi');

  const fileOptions = { filename: 'signal_card.png', contentType: 'image/png' };
  const options = caption ? { caption, parse_mode: 'Markdown' } : {};

  try {
    const result = await bot.sendPhoto(targetChatId, imageBuffer, options, fileOptions);
    return result;
  } catch (err) {
    if (isUserBlockedOrDeadError(err.message)) {
      log.warn(`Chat ${targetChatId} memblokir bot / tidak aktif. Menandai inactive...`);
      await markSubscriberInactive(targetChatId).catch(() => {});
    }
    log.error(`Gagal kirim gambar ke ${targetChatId}:`, err.message);
    throw err;
  }
}

/**
 * Kirim gambar card notifikasi.
 * Jika chatId diisi: kirim ke chat tersebut saja.
 * Jika chatId kosong: broadcast ke seluruh subscriber Supabase & .env.
 */
export async function sendPhoto(imageBuffer, caption = '', chatId) {
  if (!bot) {
    throw new Error('Bot belum diinisialisasi. Panggil initBot() terlebih dahulu.');
  }

  // Mode kirim ke 1 chat spesifik
  if (chatId) {
    const result = await sendSinglePhoto(String(chatId), imageBuffer, caption);
    log.info(`Gambar notifikasi terkirim ke chat ${chatId}`);
    return result;
  }

  // Mode broadcast ke seluruh subscriber
  const targetIds = await getBroadcastChatIds();

  if (targetIds.length === 0) {
    log.error('Tidak ada Chat ID penerima! Isi TELEGRAM_CHAT_ID di .env atau pastikan ada subscriber di Supabase.');
    return null;
  }

  log.info(`📡 Memulai broadcast gambar ke ${targetIds.length} penerima...`);
  let successCount = 0;
  let failCount = 0;

  for (const id of targetIds) {
    try {
      await sendSinglePhoto(id, imageBuffer, caption);
      successCount++;
    } catch (e) {
      failCount++;
    }
    // Delay 100ms untuk mencegah Telegram flood limit
    if (targetIds.length > 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  log.info(`📡 Broadcast gambar selesai: ${successCount} berhasil, ${failCount} gagal (Total ${targetIds.length})`);
  return { successCount, failCount, total: targetIds.length };
}

export function getBot() {
  return bot;
}

