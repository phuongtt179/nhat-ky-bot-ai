require('dotenv').config();
const express = require('express');
const { createBot, setWebhook, processUpdate } = require('./bot');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Khởi động ứng dụng
 */
async function main() {
  // Validate biến môi trường bắt buộc
  const required = ['TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY', 'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'OWNER_TELEGRAM_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('❌ Thiếu biến môi trường:', missing.join(', '));
    process.exit(1);
  }

  // Test Gemini API
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1' });
    await model.generateContent('test');
    console.log('✅ Gemini API hoạt động');
  } catch (err) {
    console.error('❌ Gemini API lỗi:', err.message, '| status:', err.status);
  }

  if (WEBHOOK_URL) {
    // === PRODUCTION MODE: Webhook ===
    const bot = createBot('webhook');

    // Endpoint nhận updates từ Telegram
    app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
      processUpdate(req.body);
      res.sendStatus(200);
    });

    // Health check endpoint cho Railway
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.listen(PORT, async () => {
      console.log(`🚀 Server đang chạy trên port ${PORT}`);
      await setWebhook(WEBHOOK_URL);
    });
  } else {
    // === DEVELOPMENT MODE: Polling ===
    createBot('polling');

    // Health check cho dev
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', mode: 'polling', timestamp: new Date().toISOString() });
    });

    app.listen(PORT, () => {
      console.log(`🛠️ Dev server trên port ${PORT} (polling mode)`);
    });
  }
}

// Xử lý lỗi không mong muốn
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

main().catch(err => {
  console.error('Khởi động thất bại:', err);
  process.exit(1);
});
