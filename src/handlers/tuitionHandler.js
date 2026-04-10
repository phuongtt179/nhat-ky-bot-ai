const firebase = require('../services/firebase');
const gemini = require('../services/gemini');
const { formatTuitionPending, escMD } = require('../utils/formatter');
const { currentMonth, formatMoney, formatMonthVN } = require('../utils/dateHelper');
const { setConfirmingSave, setTuitionClarify, resetToChat, saveLastAction } = require('../utils/stateManager');

/**
 * Xử lý ghi thu học phí
 * Pattern: "thu hp tháng 3: An 450k ck vợ, Bình 450k tiền mặt"
 */
async function handleTuition(bot, msg, text) {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    const allClasses = await firebase.getAllClasses();
    if (allClasses.length === 0) {
      await bot.sendMessage(
        chatId,
        '⚠️ Bạn chưa setup lớp nào\\. Hãy setup lớp trước khi thu học phí nhé\\!',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // Gemini parse thông tin thu hp
    const parsed = await gemini.parseTuition(text, allClasses);
    if (!parsed || !parsed.items || parsed.items.length === 0) {
      await bot.sendMessage(
        chatId,
        'Mình không đọc được thông tin học phí\\. Bạn gõ lại dạng: "thu hp tháng 3: An 450k ck vợ" nhé\\!',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const month = parsed.month || currentMonth();

    // Với mỗi học sinh, bổ sung fee nếu thiếu và kiểm tra trùng
    const enrichedItems = [];
    const duplicates = [];

    for (const item of parsed.items) {
      // Lấy fee mặc định từ classData nếu không có
      if (!item.amount && item.class_id) {
        const classData = allClasses.find(c => c.id === item.class_id);
        const student = classData?.students?.find(s =>
          s.name.toLowerCase().includes((item.student_name || '').toLowerCase().split(' ').pop())
        );
        item.amount = student?.fee || 0;
      }

      // Kiểm tra đã thu tháng này chưa
      if (item.class_id && item.student_name) {
        const existing = await firebase.getTuitionByClassAndMonth(item.class_id, month);
        const alreadyPaid = existing.find(t =>
          t.student_name.toLowerCase().includes(item.student_name.toLowerCase().split(' ').pop())
        );
        if (alreadyPaid) {
          duplicates.push({ ...item, existing: alreadyPaid });
          continue;
        }
      }

      enrichedItems.push(item);
    }

    // Cảnh báo trùng hp
    if (duplicates.length > 0) {
      const dupText = duplicates.map(d =>
        `⚠️ *${escMD(d.student_name)}* đã đóng hp tháng ${escMD(d.existing.month)} rồi \\(${escMD(formatMoney(d.existing.amount))}\\)`
      ).join('\n');

      await bot.sendMessage(chatId, dupText, { parse_mode: 'MarkdownV2' });

      if (enrichedItems.length === 0) return;
    }

    if (enrichedItems.length === 0) {
      await bot.sendMessage(chatId, '✅ Tất cả đã đóng học phí rồi\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    // Tạo summary để xác nhận
    const total = enrichedItems.reduce((sum, item) => sum + (item.amount || 0), 0);
    let confirmText = `💰 *Thu học phí ${escMD(formatMonthVN(month))}*\n━━━━━━━━━━━━━━\n\n`;

    enrichedItems.forEach((item, i) => {
      const methodLabel = getMethodLabel(item.method);
      confirmText += `${i + 1}\\. *${escMD(item.student_name)}*`;
      if (item.class_name) confirmText += ` \\(${escMD(item.class_name)}\\)`;
      confirmText += `\n   💵 ${escMD(formatMoney(item.amount))} \\- ${escMD(methodLabel)}\n\n`;
    });

    confirmText += `*Tổng: ${escMD(formatMoney(total))}*\n\n✅ Xác nhận lưu\\? \\(ok/không\\)`;

    await setConfirmingSave({
      type: 'tuition',
      month,
      items: enrichedItems,
      total,
    });

    await bot.sendMessage(chatId, confirmText, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('tuitionHandler error:', err);
    await bot.sendMessage(chatId, 'Có lỗi xảy ra khi xử lý học phí\\. Bạn thử lại nhé\\!', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Lưu nhiều bản ghi học phí sau khi xác nhận
 */
async function saveTuitionRecords(pendingData) {
  const { month, items } = pendingData;
  const savedIds = [];

  for (const item of items) {
    const record = await firebase.saveTuition({
      student_id: item.student_id || null,
      student_name: item.student_name,
      class_id: item.class_id || null,
      class_name: item.class_name || null,
      month,
      amount: item.amount || 0,
      method: item.method || 'other',
      method_note: item.method_note || '',
      note: item.note || '',
    });
    savedIds.push(record.id);
  }

  await saveLastAction({
    type: 'save_tuition',
    record_ids: savedIds,
    data: pendingData,
  });

  return savedIds;
}

/**
 * Hiển thị học phí còn thiếu của một lớp trong tháng
 */
async function showTuitionPending(bot, chatId, classId, month) {
  try {
    await bot.sendChatAction(chatId, 'typing');

    const classData = await firebase.getClass(classId);
    if (!classData) {
      await bot.sendMessage(chatId, `❌ Không tìm thấy lớp *${escMD(classId)}*\\.`, { parse_mode: 'MarkdownV2' });
      return;
    }

    const paidRecords = await firebase.getTuitionByClassAndMonth(classId, month);
    const paidStudentIds = paidRecords.map(r => r.student_id || r.student_name);

    const pending = classData.students.filter(s =>
      !paidRecords.some(r =>
        r.student_id === s.id ||
        r.student_name.toLowerCase().includes(s.name.toLowerCase().split(' ').pop())
      )
    );

    const paid = classData.students.length - pending.length;
    const remaining = pending.reduce((sum, s) => sum + (s.fee || 0), 0);

    const text = formatTuitionPending({
      month,
      className: classData.display_name,
      paid,
      total: classData.students.length,
      pending,
      remaining,
    });

    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('showTuitionPending error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi kiểm tra học phí\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Hiển thị tổng quan học phí tất cả lớp trong tháng
 */
async function showTuitionOverview(bot, chatId, month) {
  try {
    await bot.sendChatAction(chatId, 'typing');

    const allClasses = await firebase.getAllClasses();
    const tuitionRecords = await firebase.getTuitionByMonth(month);

    let text = `💰 *Học phí ${escMD(formatMonthVN(month))}*\n━━━━━━━━━━━━━━\n\n`;
    let totalCollected = 0;
    let totalExpected = 0;

    for (const classData of allClasses) {
      const classPaid = tuitionRecords.filter(r => r.class_id === classData.id);
      const paidAmount = classPaid.reduce((sum, r) => sum + (r.amount || 0), 0);
      const expectedAmount = classData.students.reduce((sum, s) => sum + (s.fee || 0), 0);
      const paidCount = classPaid.length;
      const totalStudents = classData.students.length;

      totalCollected += paidAmount;
      totalExpected += expectedAmount;

      text += `🏫 *${escMD(classData.display_name)}*\n`;
      text += `   ✅ ${paidCount}/${totalStudents} em \\- ${escMD(formatMoney(paidAmount))}\n`;

      if (paidCount < totalStudents) {
        const pendingCount = totalStudents - paidCount;
        text += `   ❌ Còn ${pendingCount} em chưa đóng\n`;
      }
      text += '\n';
    }

    text += `━━━━━━━━━━━━━━\n`;
    text += `💚 *Tổng đã thu: ${escMD(formatMoney(totalCollected))}*\n`;
    text += `💸 Còn thiếu: ${escMD(formatMoney(totalExpected - totalCollected))}`;

    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('showTuitionOverview error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi xem tổng quan học phí\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Chuyển method code sang tên hiển thị
 */
function getMethodLabel(method) {
  const labels = {
    ck_vo: 'CK vợ',
    ck_chong: 'CK chồng',
    tien_mat: 'Tiền mặt',
    other: 'Khác',
  };
  return labels[method] || method || 'Không rõ';
}

module.exports = {
  handleTuition,
  saveTuitionRecords,
  showTuitionPending,
  showTuitionOverview,
  getMethodLabel,
};
