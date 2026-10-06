import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TelegramBot = require('node-telegram-bot-api');
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TelegramBot');

let bot = null;

/**
 * Inisialisasi Telegram Bot.
 * @returns {TelegramBot} - Bot instance
 */
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
 * Kirim pesan ke chat/channel yang ditentukan.
 * @param {string} message - Pesan dalam format MarkdownV2
 * @param {string} [chatId] - Chat ID target (default dari config)
 * @returns {Promise<Object>} - Telegram message object
 */
export async function sendMessage(message, chatId) {
  const targetChatId = chatId || config.TELEGRAM_CHAT_ID;

  if (!targetChatId) {
    log.error('TELEGRAM_CHAT_ID tidak ditemukan di .env!');
    throw new Error('TELEGRAM_CHAT_ID is required');
  }

  if (!bot) {
    throw new Error('Bot belum diinisialisasi. Panggil initBot() terlebih dahulu.');
  }

  try {
    const result = await bot.sendMessage(targetChatId, message, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    });
    log.info(`Pesan terkirim ke chat ${targetChatId}`);
    return result;
  } catch (err) {
    // Fallback: coba kirim tanpa markdown jika parsing gagal
    if (err.message?.includes('parse') || err.message?.includes('markdown')) {
      log.warn('MarkdownV2 gagal, kirim sebagai plain text...');
      try {
        const plainText = message
          .replace(/\\([_\[\]()~`>#+\-=|{}.!\\])/g, '$1')
          .replace(/\*/g, '')
          .replace(/`{3}[\s\S]*?`{3}/g, (match) => match.replace(/`/g, ''));
        
        const result = await bot.sendMessage(targetChatId, plainText);
        log.info(`Pesan (plain text) terkirim ke chat ${targetChatId}`);
        return result;
      } catch (fallbackErr) {
        log.error('Gagal kirim pesan (plain text):', fallbackErr.message);
        throw fallbackErr;
      }
    }
    log.error('Gagal kirim pesan:', err.message);
    throw err;
  }
}

/**
 * Kirim batch pesan dengan delay antar pesan (anti rate-limit).
 */
export async function sendBatchMessages(messages, delayMs = 1000, chatId) {
  const results = [];
  for (let i = 0; i < messages.length; i++) {
    try {
      const result = await sendMessage(messages[i], chatId);
      results.push(result);
    } catch (err) {
      log.error(`Gagal kirim pesan ${i + 1}/${messages.length}:`, err.message);
    }

    if (i < messages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

/**
 * Kirim gambar card notifikasi ke Telegram channel/chat target.
 * @param {Buffer} imageBuffer - Buffer gambar PNG
 * @param {string} [caption] - Caption opsional
 * @param {string} [chatId] - Target Chat ID
 */
export async function sendPhoto(imageBuffer, caption = '', chatId) {
  const targetChatId = chatId || config.TELEGRAM_CHAT_ID;

  if (!targetChatId) {
    log.error('TELEGRAM_CHAT_ID tidak ditemukan di .env!');
    throw new Error('TELEGRAM_CHAT_ID is required');
  }

  if (!bot) {
    throw new Error('Bot belum diinisialisasi. Panggil initBot() terlebih dahulu.');
  }

  try {
    const fileOptions = { filename: 'signal_card.png', contentType: 'image/png' };
    const options = caption ? { caption, parse_mode: 'Markdown' } : {};
    const result = await bot.sendPhoto(targetChatId, imageBuffer, options, fileOptions);
    log.info(`Gambar notifikasi terkirim ke chat ${targetChatId}`);
    return result;
  } catch (err) {
    log.error('Gagal kirim gambar notifikasi:', err.message);
    throw err;
  }
}

/**
 * Kirim batch gambar notifikasi.
 */
export async function sendBatchPhotos(imageBuffers, delayMs = 1500, chatId) {
  const results = [];
  for (let i = 0; i < imageBuffers.length; i++) {
    try {
      const result = await sendPhoto(imageBuffers[i], '', chatId);
      results.push(result);
    } catch (err) {
      log.error(`Gagal kirim gambar ${i + 1}/${imageBuffers.length}:`, err.message);
    }

    if (i < imageBuffers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

/**
 * Dapatkan bot instance.
 */
export function getBot() {
  return bot;
}

