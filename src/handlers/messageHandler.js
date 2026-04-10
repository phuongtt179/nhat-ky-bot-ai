const firebase = require('../services/firebase');
const gemini = require('../services/gemini');
const { formatConfirmation, escMD } = require('../utils/formatter');
const { today, currentMonth, dateToWeek } = require('../utils/dateHelper');
const {
  STATES,
  getSession,
  setConfirmingSave,
  resetToChat,
  saveLastAction,
  saveLastList,
  isConfirmYes,
  isConfirmNo,
  isEditCommand,
  isDeleteCommand,
  getCommandIndex,
} = require('../utils/stateManager');
const { handleAttendance, handleAttendanceClarify, saveAttendanceRecord } = require('./attendanceHandler');
const { handleTuition, saveTuitionRecords } = require('./tuitionHandler');
const { handleEditRequest, handleDeleteRequest, handleEditSelect, handleNewValue } = require('./editHandler');

/**
 * Entry point xử lý mọi tin nhắn tự do (không phải lệnh /)
 */
async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;

  // Kiểm tra quyền truy cập (chỉ owner)
  const ownerId = process.env.OWNER_TELEGRAM_ID;
  if (ownerId && String(msg.from.id) !== String(ownerId)) {
    await bot.sendMessage(chatId, '🔒 Bot này dùng riêng tư. Không có quyền truy cập.');
    return;
  }

  try {
    const session = await getSession();

    // Ưu tiên xử lý theo state hiện tại
    switch (session.state) {
      case STATES.CONFIRMING_SAVE:
        return await handleConfirmSave(bot, msg, session, text);

      case STATES.CONFIRMING_DELETE:
        return await handleConfirmDelete(bot, msg, session, text);

      case STATES.EDITING:
        return await handleEditSelect(bot, msg, session);

      case STATES.EDITING_FIELD:
        return await handleNewValue(bot, msg, session);

      case STATES.ATTENDANCE_CLARIFY:
        return await handleAttendanceClarify(bot, msg, session);

      case STATES.TUITION_CLARIFY:
        return await handleTuitionClarify(bot, msg, session);

      case STATES.WEEKLY_REVIEW:
        return await handleWeeklyReviewResponse(bot, msg, session, text);
    }

    // Kiểm tra lệnh sửa/xóa sau list
    if (isEditCommand(text)) {
      const index = getCommandIndex(text);
      return await handleEditRequest(bot, msg, index, session);
    }
    if (isDeleteCommand(text)) {
      const index = getCommandIndex(text);
      return await handleDeleteRequest(bot, msg, index, session);
    }

    // Xử lý tin nhắn bình thường - gọi Gemini phân loại
    return await handleNormalMessage(bot, msg, text, session);
  } catch (err) {
    console.error('messageHandler error:', err);
    await bot.sendMessage(chatId, 'Có lỗi xảy ra\\. Bạn thử lại nhé\\! 😅', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Xử lý tin nhắn bình thường - phân loại qua Gemini
 */
async function handleNormalMessage(bot, msg, text, session) {
  const chatId = msg.chat.id;

  await bot.sendChatAction(chatId, 'typing');

  // Lưu tin nhắn user vào lịch sử
  await firebase.addMessageToHistory('user', text);

  // Lấy lớp học và lịch sử chat
  const allClasses = await firebase.getAllClasses();
  const chatHistory = session.messages || [];

  // Gọi Gemini phân loại
  const classified = await gemini.classifyMessage(text, allClasses, chatHistory);

  if (!classified) {
    await bot.sendMessage(chatId, 'Mình chưa hiểu\\. Bạn nói lại được không\\? 😅', { parse_mode: 'MarkdownV2' });
    return;
  }

  const { type, items, needs_confirmation, response_to_user } = classified;

  // Điều hướng theo type
  if (type === 'attendance') {
    return await handleAttendance(bot, msg, text, classified);
  }

  if (type === 'tuition') {
    return await handleTuition(bot, msg, text);
  }

  if (type === 'question' || type === 'unknown') {
    // Câu hỏi hoặc không nhận ra → tìm kiếm tự nhiên
    return await handleNaturalSearch(bot, chatId, text, classified);
  }

  if (!items || items.length === 0) {
    const reply = response_to_user || 'Mình đã ghi nhận\\!';
    await bot.sendMessage(chatId, escMD(reply), { parse_mode: 'MarkdownV2' });
    return;
  }

  // Enrichment: bổ sung date/month/week cho items
  const enrichedItems = items.map(item => ({
    ...item,
    date: item.date || today(),
    month: item.date ? item.date.substring(0, 7) : currentMonth(),
    week: item.date ? dateToWeek(item.date) : dateToWeek(today()),
  }));

  // Cần xác nhận trước khi lưu?
  if (needs_confirmation) {
    const confirmText = formatConfirmation(enrichedItems);
    await setConfirmingSave({ type: 'entries', items: enrichedItems });
    await bot.sendMessage(chatId, confirmText, { parse_mode: 'MarkdownV2' });
    return;
  }

  // Lưu trực tiếp không cần xác nhận (entry đơn giản, rõ ràng)
  await saveEntries(enrichedItems);
  await firebase.addMessageToHistory('assistant', response_to_user || 'Đã ghi lại!');
  await saveLastAction({ type: 'save_entries', items: enrichedItems });

  const reply = response_to_user || `✅ Đã ghi lại ${enrichedItems.length} mục\\.`;
  await bot.sendMessage(chatId, escMD(reply), { parse_mode: 'MarkdownV2' });
}

/**
 * Xử lý xác nhận lưu (ok/không)
 */
async function handleConfirmSave(bot, msg, session, text) {
  const chatId = msg.chat.id;
  const pendingData = session.pending_data;

  if (isConfirmYes(text)) {
    await resetToChat();

    try {
      if (pendingData?.type === 'entries') {
        await saveEntries(pendingData.items);
        await saveLastAction({ type: 'save_entries', items: pendingData.items });
        await bot.sendMessage(chatId, `✅ Đã lưu *${pendingData.items.length} mục*\\.`, { parse_mode: 'MarkdownV2' });

      } else if (pendingData?.type === 'attendance') {
        await saveAttendanceRecord(pendingData);
        await bot.sendMessage(chatId, '✅ Đã lưu điểm danh\\.', { parse_mode: 'MarkdownV2' });

      } else if (pendingData?.type === 'tuition') {
        const ids = await saveTuitionRecords(pendingData);
        await bot.sendMessage(
          chatId,
          `✅ Đã lưu học phí *${pendingData.items.length} học sinh*\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      }
    } catch (err) {
      console.error('handleConfirmSave error:', err);
      await bot.sendMessage(chatId, 'Có lỗi khi lưu\\. Bạn thử lại nhé\\!', { parse_mode: 'MarkdownV2' });
    }

  } else if (isConfirmNo(text)) {
    await resetToChat();
    await bot.sendMessage(chatId, '↩️ Đã hủy, không lưu\\.', { parse_mode: 'MarkdownV2' });

  } else {
    await bot.sendMessage(
      chatId,
      'Bạn gõ *ok* để lưu hoặc *không* để hủy nhé\\!',
      { parse_mode: 'MarkdownV2' }
    );
  }
}

/**
 * Xử lý xác nhận xóa
 */
async function handleConfirmDelete(bot, msg, session, text) {
  const chatId = msg.chat.id;
  const { editing_entry_id, pending_data } = session;

  if (isConfirmYes(text)) {
    await resetToChat();
    try {
      await firebase.deleteEntry(editing_entry_id);
      await saveLastAction({ type: 'delete_entry', entry_id: editing_entry_id, data: pending_data?.entry_info });
      await bot.sendMessage(chatId, '🗑️ Đã xóa\\.', { parse_mode: 'MarkdownV2' });
    } catch (err) {
      console.error('handleConfirmDelete error:', err);
      await bot.sendMessage(chatId, 'Có lỗi khi xóa\\. Bạn thử lại nhé\\!', { parse_mode: 'MarkdownV2' });
    }

  } else if (isConfirmNo(text)) {
    await resetToChat();
    await bot.sendMessage(chatId, '↩️ Đã hủy, không xóa\\.', { parse_mode: 'MarkdownV2' });

  } else {
    await bot.sendMessage(chatId, 'Gõ *ok* để xóa hoặc *không* để hủy nhé\\!', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Xử lý xác nhận học phí trùng
 */
async function handleTuitionClarify(bot, msg, session) {
  const chatId = msg.chat.id;
  await resetToChat();
  await bot.sendMessage(chatId, 'Bạn kiểm tra lại và nhập lại thông tin học phí nhé\\!', { parse_mode: 'MarkdownV2' });
}

/**
 * Xử lý phản hồi trong weekly review
 */
async function handleWeeklyReviewResponse(bot, msg, session, text) {
  const chatId = msg.chat.id;
  // Weekly review chủ yếu là xem → reset về chatting
  await resetToChat();
  await handleNormalMessage(bot, msg, text, session);
}

/**
 * Tìm kiếm tự nhiên - query Firestore + Gemini tổng hợp
 */
async function handleNaturalSearch(bot, chatId, query, classified) {
  await bot.sendChatAction(chatId, 'typing');

  try {
    // Kiểm tra xem có phải yêu cầu tổng hợp nhật ký không
    const isDiarySummary = /nhật ký|nhat ky|tổng hợp|tong hop|làm được gì|lam duoc gi|tháng .+ có gì/i.test(query);

    if (isDiarySummary) {
      return await handleDiarySummary(bot, chatId, query);
    }

    // Phân tích query để xác định cần data gì
    const params = await gemini.analyzeQuery(query);
    const { collections, month, date, date_from, date_to, type, class_id } = params;

    const data = {};

    // Query các collections cần thiết
    if (collections.includes('entries')) {
      if (month) data.entries = await firebase.getEntriesByMonth(month);
      else if (date) data.entries = await firebase.getEntriesByDate(date);
      else if (date_from) data.entries = await firebase.queryEntries({ dateFrom: date_from, dateTo: date_to, type });
      else data.entries = await firebase.getEntriesByMonth(currentMonth());
    }

    if (collections.includes('attendance')) {
      if (month && class_id) data.attendance = await firebase.getAttendanceByClassAndMonth(class_id, month);
      else if (month) data.attendance = await firebase.getAttendanceByMonth(month);
    }

    if (collections.includes('tuition')) {
      if (month) data.tuition = await firebase.getTuitionByMonth(month);
    }

    // Gemini tổng hợp câu trả lời
    const answer = await gemini.searchAndAnswer(data, query);

    await firebase.addMessageToHistory('assistant', answer);
    await bot.sendMessage(chatId, escMD(answer), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('handleNaturalSearch error:', err);
    await bot.sendMessage(chatId, 'Mình tìm không thấy\\. Bạn thử hỏi cách khác nhé\\!', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Tổng hợp nhật ký theo tháng/khoảng thời gian
 */
async function handleDiarySummary(bot, chatId, query) {
  await bot.sendChatAction(chatId, 'typing');

  try {
    // Gemini xác định tháng/khoảng thời gian cần tổng hợp
    const params = await gemini.analyzeQuery(query);
    const month = params.month || currentMonth();

    // Query tất cả data của tháng đó
    const [entries, attendance, tuition] = await Promise.all([
      firebase.getEntriesByMonth(month),
      firebase.getAttendanceByMonth(month),
      firebase.getTuitionByMonth(month),
    ]);

    if (entries.length === 0 && attendance.length === 0 && tuition.length === 0) {
      await bot.sendMessage(
        chatId,
        `📖 Chưa có dữ liệu nào cho tháng ${escMD(month.replace('-', '/'))}\\. Hãy bắt đầu ghi chép nhé\\! 😊`,
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // Gemini tổng hợp nhật ký
    const { formatMonthVN } = require('../utils/dateHelper');
    const summary = await gemini.summarizeDiary(entries, attendance, tuition, query, formatMonthVN(month));

    await firebase.addMessageToHistory('assistant', summary);
    await bot.sendMessage(chatId, escMD(summary), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('handleDiarySummary error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi tổng hợp nhật ký\\. Bạn thử lại nhé\\!', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Lưu nhiều entries vào Firestore
 */
async function saveEntries(items) {
  for (const item of items) {
    await firebase.saveEntry(item);
  }
}

module.exports = {
  handleMessage,
  handleNaturalSearch,
  handleDiarySummary,
  saveEntries,
};
