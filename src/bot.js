const TelegramBot = require('node-telegram-bot-api');
const { handleMessage } = require('./handlers/messageHandler');
const { registerCommands } = require('./handlers/commandHandler');
const { startScheduler } = require('./services/scheduler');

let bot = null;

/**
 * Khởi tạo bot Telegram
 * @param {string} mode - 'webhook' hoặc 'polling'
 */
function createBot(mode = 'polling') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN chưa được cấu hình!');

  if (mode === 'webhook') {
    // Webhook mode - dùng cho production (Railway)
    bot = new TelegramBot(token, { webHook: true });
  } else {
    // Polling mode - dùng cho development local
    bot = new TelegramBot(token, { polling: true });
    console.log('🤖 Bot đang chạy ở chế độ polling (development)');
  }

  // Đăng ký các lệnh /
  registerCommands(bot);

  // Xử lý mọi tin nhắn text (không phải lệnh)
  bot.on('message', async (msg) => {
    // Bỏ qua nếu là lệnh / (đã xử lý bởi registerCommands)
    if (msg.text?.startsWith('/')) return;
    await handleMessage(bot, msg);
  });

  // Xử lý callback từ inline keyboard (weekly review buttons)
  bot.on('callback_query', async (callbackQuery) => {
    await handleCallbackQuery(bot, callbackQuery);
  });

  // Xử lý lỗi polling
  bot.on('polling_error', (err) => {
    console.error('Polling error:', err.message);
  });

  bot.on('webhook_error', (err) => {
    console.error('Webhook error:', err.message);
  });

  // Khởi động scheduler
  startScheduler(bot);

  console.log('✅ Bot đã khởi động thành công!');
  return bot;
}

/**
 * Xử lý callback query từ inline keyboard
 */
async function handleCallbackQuery(bot, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  try {
    // Trả lời callback để Telegram biết đã nhận
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'review_good') {
      await bot.sendMessage(chatId, '😊 Tuyệt vời\\! Tuần tốt thì tiếp tục phát huy nhé\\!', { parse_mode: 'MarkdownV2' });
    } else if (data === 'review_tired') {
      await bot.sendMessage(chatId, '💆 Nghỉ ngơi đi nhé\\! Tuần sau sẽ tốt hơn\\. Bạn đã cố gắng rất nhiều rồi\\! 💪', { parse_mode: 'MarkdownV2' });
    } else if (data === 'review_report') {
      const { currentMonth } = require('./utils/dateHelper');
      const { handleReport } = require('./handlers/reportHandler');
      await handleReport(bot, chatId, 'thongke', currentMonth());
    }
  } catch (err) {
    console.error('handleCallbackQuery error:', err);
  }
}

/**
 * Set webhook URL cho bot
 */
async function setWebhook(webhookUrl) {
  if (!bot) throw new Error('Bot chưa được khởi tạo');
  const url = `${webhookUrl}/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
  await bot.setWebHook(url);
  console.log(`✅ Webhook đã set: ${url}`);
}

/**
 * Xử lý tin nhắn từ webhook
 */
function processUpdate(update) {
  if (!bot) throw new Error('Bot chưa được khởi tạo');
  bot.processUpdate(update);
}

/**
 * Lấy instance bot hiện tại
 */
function getBot() {
  return bot;
}

module.exports = {
  createBot,
  setWebhook,
  processUpdate,
  getBot,
};
