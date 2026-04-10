# 🤖 Nhật Ký Bot AI - Trợ lý cá nhân cho giáo viên

Telegram Bot thông minh giúp ghi chép nhật ký, quản lý lớp học, điểm danh, học phí và tổng hợp báo cáo tự động bằng tiếng Việt.

---

## ✨ Tính năng

- 📝 **Ghi chép tự nhiên** - Chat như với người bạn, AI tự phân loại
- 💭 **Nhật ký cá nhân** - Ghi cảm xúc, tổng hợp theo tháng
- 🏫 **Quản lý lớp học** - Setup học sinh, lịch học, học phí
- ✅ **Điểm danh thông minh** - Match tên mờ, xử lý trùng tên
- 💰 **Thu học phí** - Ghi nhanh, tra cứu còn thiếu
- 🔍 **Tìm kiếm tự nhiên** - "thay nhớt xe lần gần nhất ngày mấy?"
- 📖 **Tổng hợp nhật ký** - "tháng 3 làm được gì?"
- 🔔 **Nhắc lịch tự động** - Sáng, tối, weekly review, nhắc hp
- 📊 **Báo cáo & thống kê** - Chi tiêu, học phí, chuyên cần, công việc

---

## 🚀 Hướng dẫn cài đặt

### Bước 1: Tạo Telegram Bot

1. Mở Telegram, tìm **@BotFather**
2. Gõ `/newbot` → nhập tên bot → nhập username
3. Copy **Bot Token** được cấp

### Bước 2: Lấy Gemini API Key

1. Vào [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API key** → **Create API key**
3. Copy API key

### Bước 3: Setup Firebase Firestore

1. Vào [console.firebase.google.com](https://console.firebase.google.com)
2. Tạo project mới
3. Chọn **Firestore Database** → **Create database** → chọn region `asia-southeast1`
4. Vào **Project Settings** → **Service accounts** → **Generate new private key**
5. Download file JSON, lấy các thông tin:
   - `project_id`
   - `private_key`
   - `client_email`

### Bước 4: Lấy Telegram User ID

1. Mở Telegram, tìm **@userinfobot**
2. Gõ `/start` → Copy **Id** của bạn

### Bước 5: Cấu hình biến môi trường

```bash
cp .env.example .env
```

Mở file `.env` và điền đầy đủ:

```env
TELEGRAM_BOT_TOKEN=your_token_here
GEMINI_API_KEY=your_gemini_key_here
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@project.iam.gserviceaccount.com
OWNER_TELEGRAM_ID=your_telegram_id
PORT=3000
# WEBHOOK_URL để trống khi dev local
```

### Bước 6: Cài đặt và chạy local

```bash
npm install
npm run dev
```

Bot sẽ chạy ở chế độ **polling** - mở Telegram và nhắn thử `/start`.

---

## 🚂 Deploy lên Railway.app

### Bước 1: Push code lên GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/username/diary-bot.git
git push -u origin main
```

### Bước 2: Tạo project trên Railway

1. Vào [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Chọn repo vừa push

### Bước 3: Cấu hình biến môi trường trên Railway

Vào **Settings** → **Variables** → thêm tất cả biến trong `.env.example`:
- Thêm `WEBHOOK_URL=https://your-app-name.railway.app`
- Để `PORT` để Railway tự cấu hình

### Bước 4: Set Webhook Telegram

Bot sẽ tự set webhook khi khởi động. Hoặc set thủ công:

```
https://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url=https://your-app.railway.app/webhook/{BOT_TOKEN}
```

---

## 💬 Cách sử dụng

### Ghi chép tự nhiên
```
"hôm nay dạy lớp 4A, bài PowerPoint"
"chi 50k cafe sáng"
"họp chuyên môn thứ 6 tuần này 14h"
"nhớ soạn giáo án trước thứ 4"
"hôm nay mệt quá, học sinh ồn ào"
```

### Setup lớp học
```
"setup nhóm tin 3-5
 lịch thứ 3 + thứ 6
 học 2 buổi: Nguyễn Văn An, Trần Thị Bình
 chỉ thứ 3: Phạm Thu Hà"
```

### Điểm danh
```
"tin 3-5 vắng An, Bình"
"tin 3-5 đủ hết"
"lớp tin thứ 6 vắng Nam có phép"
```

### Thu học phí
```
"thu hp tháng 3: An 450k ck vợ, Bình 450k tiền mặt"
"thu hp tháng 3 lớp tin 3-5: An, Bình, Tuấn" (tự lấy hp từ setup)
```

### Tìm kiếm & Nhật ký
```
"nhật ký tháng 3"
"tháng 3 làm được gì?"
"thay nhớt xe lần gần nhất ngày mấy?"
"em nào vắng nhiều nhất tháng 3?"
```

### Lệnh nhanh
```
/homnay    - Lịch hôm nay
/tuannay   - Lịch cả tuần
/conlai    - Việc chưa xong
/baocao    - Báo cáo
/hocphi    - Tổng quan học phí
/danhsach  - Danh sách lớp
/hoantac   - Undo thao tác vừa làm
/timkiem   - Tìm kiếm
/huongdan  - Hướng dẫn
```

---

## 🏗️ Cấu trúc project

```
diary-bot/
├── src/
│   ├── index.js                 # Entry point + webhook server
│   ├── bot.js                   # Khởi tạo bot, routing
│   ├── services/
│   │   ├── firebase.js          # CRUD Firestore
│   │   ├── gemini.js            # AI + system prompt
│   │   └── scheduler.js         # Cron jobs tự động
│   ├── handlers/
│   │   ├── messageHandler.js    # Tin nhắn tự do + state machine
│   │   ├── commandHandler.js    # Lệnh /
│   │   ├── editHandler.js       # Sửa/xóa sau list
│   │   ├── reportHandler.js     # Báo cáo & thống kê
│   │   ├── attendanceHandler.js # Điểm danh thông minh
│   │   ├── tuitionHandler.js    # Học phí
│   │   └── setupHandler.js      # Setup lớp học
│   └── utils/
│       ├── formatter.js         # Format Markdown Telegram
│       ├── dateHelper.js        # Xử lý ngày tiếng Việt
│       └── stateManager.js      # Quản lý session/state
├── .env.example
├── package.json
├── Dockerfile
└── railway.toml
```

---

## 🔧 Tech Stack

| Thành phần | Công nghệ |
|---|---|
| Runtime | Node.js 20+ |
| Telegram | node-telegram-bot-api |
| AI | Google Gemini 2.0 Flash |
| Database | Firebase Firestore |
| Scheduler | node-cron |
| Deploy | Railway.app |
