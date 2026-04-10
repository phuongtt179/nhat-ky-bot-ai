# CLAUDE.md - Ngữ cảnh dự án Nhật Ký Bot AI

## Tổng quan
Telegram Bot trợ lý cá nhân cho **giáo viên tiểu học Việt Nam**.
- Chat tự nhiên tiếng Việt → AI phân loại → lưu Firestore
- Quản lý lớp học, điểm danh, học phí, nhắc lịch, tổng hợp nhật ký

## Tech Stack
| | |
|---|---|
| Runtime | Node.js 20+ |
| Telegram | node-telegram-bot-api |
| AI | Google Gemini 2.0 Flash (`@google/generative-ai`) |
| Database | Firebase Firestore (`firebase-admin`) |
| Scheduler | node-cron |
| Deploy | Railway.app (webhook mode) |

---

## Trạng thái dự án

### ✅ Đã hoàn thành (toàn bộ code)
Tất cả 16 files đã được viết. Bot chạy được sau khi điền `.env`.

### ⏳ Đang chờ (người dùng đang làm)
- Lấy `TELEGRAM_BOT_TOKEN` từ @BotFather
- Lấy `GEMINI_API_KEY` từ aistudio.google.com
- Setup Firebase Firestore + lấy Service Account key
- Lấy `OWNER_TELEGRAM_ID` từ @userinfobot
- Điền vào file `.env`
- Chạy `npm install` → `npm run dev` để test

### 🔜 Việc tiếp theo sau khi bot chạy được
1. Test thực tế từng chức năng
2. Fix bugs phát sinh khi dùng thật
3. Tuning Gemini prompt nếu AI phân loại sai
4. Thêm Firestore indexes nếu query báo lỗi
5. Deploy lên Railway.app

---

## Cấu trúc file & chức năng

```
src/
├── index.js              Entry point. Khởi động Express server.
│                         Webhook mode (production) hoặc polling (dev).
│
├── bot.js                Tạo TelegramBot instance. Đăng ký handlers.
│                         Xử lý callback_query (inline keyboard).
│
├── services/
│   ├── firebase.js       TẤT CẢ thao tác Firestore. Không có logic nghiệp vụ.
│   ├── gemini.js         TẤT CẢ gọi Gemini API. System prompt ở đây.
│   └── scheduler.js      4 cron jobs: sáng 6:30, tối 20:00, CN 20:30, ngày 25.
│
├── handlers/
│   ├── messageHandler.js Hub chính. State machine. Route tin nhắn đến handler đúng.
│   ├── commandHandler.js Xử lý lệnh /. Đăng ký qua registerCommands(bot).
│   ├── editHandler.js    Flow sửa/xóa entry theo số sau khi list.
│   ├── reportHandler.js  6 loại báo cáo: chitieu/hocphi/diemdanh/giangday/congviec/tonghop.
│   ├── attendanceHandler.js Điểm danh thông minh. Match tên mờ. Xử lý trùng tên.
│   ├── tuitionHandler.js Thu học phí. Kiểm tra trùng. Tổng quan hp.
│   └── setupHandler.js   CRUD lớp học và học sinh.
│
└── utils/
    ├── formatter.js      Format Markdown v2 Telegram. Tất cả escMD() ở đây.
    ├── dateHelper.js     Xử lý ngày tiếng Việt, session key, format tiền.
    └── stateManager.js   STATES enum. Get/set session state. isConfirmYes/No.
```

---

## Firestore Data Model

```
users/{OWNER_TELEGRAM_ID}/
  ├── profile/info          Thông tin user, settings
  ├── sessions/current      State machine: state, messages[], last_list[], last_action, pending_data
  ├── entries/{id}          Ghi chép: type, title, content, date, month, week, amount, status...
  ├── classes/{class_id}    Lớp học: display_name, subject, sessions[], students[]
  ├── attendance/{id}       Điểm danh: class_id, date, session, absent[], present_count
  └── tuition/{id}          Học phí: student_name, class_id, month, amount, method
```

**Entry types:** `expense | income | teaching | personal | activity | schedule | task | attendance | tuition`

**Session states:** `chatting | confirming | confirming_delete | editing | editing_field | setup_class | weekly_review | attendance_clarify | tuition_clarify`

---

## Hàm đã viết - Tránh trùng lặp

### `src/services/firebase.js`
```
saveEntry, getEntriesByMonth, getEntriesByDate, getEntriesByWeek,
getEntriesByTypeAndMonth, getPendingTasks, getUpcomingSchedules,
updateEntry, deleteEntry, getEntryById, queryEntries, getEntriesWithReminder,
saveClass, getClass, getAllClasses, deleteClass,
saveAttendance, getAttendanceByClassAndMonth, getAttendanceByDateAndClass,
getAttendanceByMonth, updateAttendance,
saveTuition, getTuitionByClassAndMonth, getTuitionByMonth, getTuitionByStudent,
getSession, updateSession, resetSession, addMessageToHistory,
getProfile, saveProfile
```

### `src/services/gemini.js`
```
classifyMessage(msg, userClasses, chatHistory)    → JSON phân loại tin nhắn
parseAttendance(msg, classData)                   → JSON điểm danh
matchStudentNames(absentNames, studentList)        → JSON match tên
parseTuition(msg, allClasses)                     → JSON học phí
parseClassSetup(msg)                              → JSON setup lớp
analyzeQuery(query)                               → JSON params query Firestore
searchAndAnswer(data, query)                      → text câu trả lời
summarizeDiary(entries, attendance, tuition, query, period) → text tổng hợp
generateWeeklyReview(entries, attendance, tuition, week)    → JSON review
generateReport(type, data, month)                 → text báo cáo
buildSystemPrompt(userClasses)                    → string system prompt
```

### `src/utils/dateHelper.js`
```
today(), tomorrow(), yesterday(), currentMonth(), currentWeek()
todayDayName(), todaySession()
sessionToDisplayName(session)     "thu_3" → "Thứ ba"
dateToWeekday(dateStr), dateToWeek(dateStr)
getWeekRange(dateStr)             → { start, end, label }
getSessionDatesThisWeek(sessions)
hasTodaySession(sessions), getTodaySession(sessions)
formatDateVN(dateStr)             "2026-04-09" → "Thứ năm, 09/04/2026"
formatMonthVN(monthStr)           "2026-04" → "Tháng 4/2026"
formatMoney(amount)               450000 → "450.000đ"
previousMonth(monthStr), nextMonth(monthStr)
getSessionDatesInMonth(sessions, monthStr)
DAY_MAP, DAY_NAMES_VN, DAY_TO_SESSION   (mapping constants)
```

### `src/utils/formatter.js`
```
escMD(text)                       Escape Markdown v2
safeText(text)
formatConfirmation(items)         Hiển thị trước khi lưu
formatListWithIndex(items)        List có [1][2][3] để sửa/xóa
formatAttendance(data)
formatTuitionPending(data)
formatClassInfo(classData)
formatToday(date, dayName, entries, classes)
formatWeek(weekLabel, dailyData)
formatPendingTasks(tasks)
formatMorningReminder(...)
formatEveningReminder(...)
formatEntry(entry)
getTypeEmoji(type)
```

### `src/utils/stateManager.js`
```
STATES                            Enum các trạng thái
getSession()
setConfirmingSave(pendingData)
setConfirmingDelete(entryId, entryInfo)
setEditing(entryId, entryData)
setEditingField(entryId, field, entryData)
setAttendanceClarify(pendingData)
setTuitionClarify(pendingData)
setWeeklyReview(reviewData)
resetToChat()
saveLastList(items), getLastListItem(index)
saveLastAction(action), getLastAction()
isConfirmYes(text), isConfirmNo(text)
isEditCommand(text), isDeleteCommand(text)
getCommandIndex(text)
```

### `src/handlers/commandHandler.js` - Lệnh đã đăng ký
```
/start, /homnay, /tuannay, /conlai
/baocao [chitieu|hocphi|diemdanh|giangday|congviec|tonghop] [thangN]
/thongke [thangN]
/timkiem [query]
/hoantac, /huongdan, /danhsach, /hocphi [thangN]
```

### `src/handlers/reportHandler.js`
```
handleReport(bot, chatId, type, month)   Router chính
reportChiTieu, reportHocPhi, reportDiemDanh
reportGiangDay, reportCongViec, reportThongKe, reportTongHop
```

### `src/handlers/attendanceHandler.js`
```
handleAttendance(bot, msg, text, parsedFromGemini)
handleAttendanceClarify(bot, msg, session)
saveAttendanceRecord(pendingData)
queryAttendance(bot, chatId, query, params)
findMatchingClass(allClasses, name)      Tìm lớp gần đúng
```

### `src/handlers/tuitionHandler.js`
```
handleTuition(bot, msg, text)
saveTuitionRecords(pendingData)
showTuitionPending(bot, chatId, classId, month)
showTuitionOverview(bot, chatId, month)
getMethodLabel(method)              "ck_vo" → "CK vợ"
```

### `src/handlers/setupHandler.js`
```
handleSetup(bot, msg, text)
handleListClasses(bot, chatId)
handleViewClass(bot, chatId, classIdentifier)
+ private: handleCreateClass, handleUpdateClass, handleAddStudent,
           handleRemoveStudent, handleUpdateStudent
```

### `src/handlers/editHandler.js`
```
handleEditRequest(bot, msg, index, session)    Bắt đầu flow sửa
handleEditSelect(bot, msg, session)            Chọn field
handleNewValue(bot, msg, session)              Nhập giá trị mới
handleDeleteRequest(bot, msg, index, session)
+ private: convertFieldValue(field, value), parseAmount(value)
```

### `src/handlers/messageHandler.js`
```
handleMessage(bot, msg)              Entry point chính
handleNormalMessage(bot, msg, text, session)
handleConfirmSave(bot, msg, session, text)
handleConfirmDelete(bot, msg, session, text)
handleNaturalSearch(bot, chatId, query, classified)
handleDiarySummary(bot, chatId, query)
saveEntries(items)
```

---

## Lưu ý khi tiếp tục phát triển

1. **Firestore indexes**: Khi query bị lỗi "requires index", tạo composite index trên Firebase Console
2. **Gemini rate limit**: Model `gemini-2.0-flash` có giới hạn RPM - không loop gọi liên tục
3. **Markdown v2**: Luôn dùng `escMD()` khi gửi text động. Các ký tự đặc biệt: `_ * [ ] ( ) ~ > # + - = | { } . !`
4. **Session per user**: Code hiện tại dùng `OWNER_TELEGRAM_ID` cố định - chỉ 1 user
5. **dayjs plugins**: `isoWeek` và `weekOfYear` đã được extend trong `dateHelper.js`
6. **State machine**: Mọi luồng hội thoại đa bước đều đi qua `session.state` - đọc `stateManager.js` trước khi thêm flow mới
