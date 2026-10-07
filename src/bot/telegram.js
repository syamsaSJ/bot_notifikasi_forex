import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TelegramBot = require('node-telegram-bot-api');
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

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

export function getBot() {
  return bot;
}
