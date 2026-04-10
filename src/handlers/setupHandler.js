const firebase = require('../services/firebase');
const gemini = require('../services/gemini');
const { formatClassInfo, escMD } = require('../utils/formatter');
const { resetToChat, setConfirmingSave } = require('../utils/stateManager');
const { formatMoney } = require('../utils/dateHelper');

/**
 * Xử lý tin nhắn setup lớp học
 * Các pattern: "setup nhóm...", "thêm học sinh...", "xóa học sinh...", "cập nhật hp..."
 */
async function handleSetup(bot, msg, text) {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    // Gọi Gemini phân tích lệnh setup
    const parsed = await gemini.parseClassSetup(text);
    if (!parsed) {
      await bot.sendMessage(chatId, 'Mình chưa hiểu lệnh setup này\\. Bạn thử mô tả lại nhé\\! 😅', { parse_mode: 'MarkdownV2' });
      return;
    }

    const { action, class_id, display_name, subject, sessions, students, response_to_user } = parsed;

    if (action === 'create') {
      await handleCreateClass(bot, chatId, parsed);
    } else if (action === 'update') {
      await handleUpdateClass(bot, chatId, parsed);
    } else if (action === 'add_student') {
      await handleAddStudent(bot, chatId, parsed);
    } else if (action === 'remove_student') {
      await handleRemoveStudent(bot, chatId, parsed);
    } else if (action === 'update_student') {
      await handleUpdateStudent(bot, chatId, parsed);
    } else {
      await bot.sendMessage(chatId, escMD(response_to_user || 'Đã xử lý lệnh setup.'), { parse_mode: 'MarkdownV2' });
    }
  } catch (err) {
    console.error('setupHandler error:', err);
    await bot.sendMessage(chatId, 'Có lỗi xảy ra khi setup lớp học\\. Bạn thử lại nhé\\!', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Tạo lớp học mới
 */
async function handleCreateClass(bot, chatId, parsed) {
  const { class_id, display_name, subject, sessions, students } = parsed;

  // Kiểm tra lớp đã tồn tại chưa
  const existing = await firebase.getClass(class_id);
  if (existing) {
    await bot.sendMessage(
      chatId,
      `⚠️ Lớp *${escMD(display_name)}* đã tồn tại rồi\\!\nBạn muốn ghi đè hay thêm học sinh?`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  // Tạo ID học sinh tự động nếu chưa có
  const processedStudents = (students || []).map((s, i) => ({
    id: s.id || `s${String(i + 1).padStart(3, '0')}`,
    name: s.name,
    main_class: s.main_class || null,
    sessions: s.sessions || sessions,
    fee: s.fee || 0,
    note: s.note || '',
  }));

  const classData = {
    display_name,
    subject: subject || 'Tin học',
    sessions: sessions || [],
    students: processedStudents,
    created_at: new Date().toISOString(),
  };

  // Lưu lớp học
  await firebase.saveClass(class_id, classData);

  // Tạo entry ghi lại việc tạo lớp
  await firebase.saveEntry({
    type: 'teaching',
    title: `Tạo lớp ${display_name}`,
    content: `Setup lớp mới: ${display_name} - ${processedStudents.length} học sinh`,
  });

  // Hiển thị thông tin lớp vừa tạo
  const classInfo = formatClassInfo({ id: class_id, ...classData });
  await bot.sendMessage(
    chatId,
    `✅ *Đã tạo lớp thành công\\!*\n\n${classInfo}`,
    { parse_mode: 'MarkdownV2' }
  );
}

/**
 * Cập nhật thông tin lớp (lịch, môn...)
 */
async function handleUpdateClass(bot, chatId, parsed) {
  const { class_id, display_name, sessions, subject } = parsed;

  const existing = await firebase.getClass(class_id);
  if (!existing) {
    await bot.sendMessage(chatId, `❌ Không tìm thấy lớp *${escMD(display_name || class_id)}*\\.`, { parse_mode: 'MarkdownV2' });
    return;
  }

  const updates = {};
  if (display_name) updates.display_name = display_name;
  if (sessions) updates.sessions = sessions;
  if (subject) updates.subject = subject;

  await firebase.saveClass(class_id, updates);
  await bot.sendMessage(chatId, `✅ Đã cập nhật lớp *${escMD(existing.display_name)}*\\.`, { parse_mode: 'MarkdownV2' });
}

/**
 * Thêm học sinh vào lớp
 */
async function handleAddStudent(bot, chatId, parsed) {
  const { class_id, display_name, students } = parsed;

  const classData = await firebase.getClass(class_id);
  if (!classData) {
    await bot.sendMessage(chatId, `❌ Không tìm thấy lớp *${escMD(display_name || class_id)}*\\.`, { parse_mode: 'MarkdownV2' });
    return;
  }

  const existingStudents = classData.students || [];
  const newStudents = (students || []).map((s, i) => ({
    id: s.id || `s${String(existingStudents.length + i + 1).padStart(3, '0')}`,
    name: s.name,
    main_class: s.main_class || null,
    sessions: s.sessions || classData.sessions,
    fee: s.fee || 0,
    note: s.note || '',
  }));

  const updatedStudents = [...existingStudents, ...newStudents];
  await firebase.saveClass(class_id, { students: updatedStudents });

  const addedNames = newStudents.map(s => s.name).join(', ');
  await bot.sendMessage(
    chatId,
    `✅ Đã thêm *${newStudents.length} học sinh* vào lớp *${escMD(classData.display_name)}*:\n${escMD(addedNames)}`,
    { parse_mode: 'MarkdownV2' }
  );
}

/**
 * Xóa học sinh khỏi lớp
 */
async function handleRemoveStudent(bot, chatId, parsed) {
  const { class_id, display_name, students } = parsed;

  const classData = await firebase.getClass(class_id);
  if (!classData) {
    await bot.sendMessage(chatId, `❌ Không tìm thấy lớp *${escMD(display_name || class_id)}*\\.`, { parse_mode: 'MarkdownV2' });
    return;
  }

  const removeNames = (students || []).map(s => s.name.toLowerCase());
  const remaining = classData.students.filter(
    s => !removeNames.includes(s.name.toLowerCase())
  );
  const removedCount = classData.students.length - remaining.length;

  await firebase.saveClass(class_id, { students: remaining });

  await bot.sendMessage(
    chatId,
    `✅ Đã xóa *${removedCount} học sinh* khỏi lớp *${escMD(classData.display_name)}*\\. Còn lại ${remaining.length} em\\.`,
    { parse_mode: 'MarkdownV2' }
  );
}

/**
 * Cập nhật thông tin học sinh (hp, buổi học...)
 */
async function handleUpdateStudent(bot, chatId, parsed) {
  const { class_id, display_name, students } = parsed;

  const classData = await firebase.getClass(class_id);
  if (!classData) {
    await bot.sendMessage(chatId, `❌ Không tìm thấy lớp *${escMD(display_name || class_id)}*\\.`, { parse_mode: 'MarkdownV2' });
    return;
  }

  const updatedStudents = classData.students.map(existing => {
    const update = (students || []).find(s =>
      s.name.toLowerCase().includes(existing.name.toLowerCase().split(' ').pop()) ||
      existing.name.toLowerCase().includes(s.name.toLowerCase().split(' ').pop())
    );
    if (!update) return existing;

    return {
      ...existing,
      fee: update.fee !== undefined ? update.fee : existing.fee,
      sessions: update.sessions || existing.sessions,
      note: update.note || existing.note,
    };
  });

  await firebase.saveClass(class_id, { students: updatedStudents });

  const updatedNames = (students || []).map(s => {
    const updates = [];
    if (s.fee) updates.push(`hp: ${formatMoney(s.fee)}`);
    if (s.sessions) updates.push(`lịch: ${s.sessions.join(', ')}`);
    return `${s.name} (${updates.join(', ')})`;
  }).join(', ');

  await bot.sendMessage(
    chatId,
    `✅ Đã cập nhật: ${escMD(updatedNames)}`,
    { parse_mode: 'MarkdownV2' }
  );
}

/**
 * Xử lý lệnh /danhsach - hiển thị tất cả lớp
 */
async function handleListClasses(bot, chatId) {
  try {
    const classes = await firebase.getAllClasses();
    if (classes.length === 0) {
      await bot.sendMessage(
        chatId,
        '📚 Chưa có lớp nào\\. Nhắn "setup nhóm\\.\\.\\." để tạo lớp đầu tiên\\!',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    let text = `🏫 *Danh sách lớp học \\(${classes.length} lớp\\)*\n━━━━━━━━━━━━━━\n\n`;
    classes.forEach((c, i) => {
      text += `${i + 1}\\. *${escMD(c.display_name)}* \\- ${escMD(c.subject)}\n`;
      text += `   👥 ${c.students?.length || 0} em \\| 📅 ${(c.sessions || []).map(s => escMD(s)).join(', ')}\n\n`;
    });

    text += `_Gõ tên lớp để xem chi tiết_`;
    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('handleListClasses error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi lấy danh sách lớp\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Xem chi tiết một lớp theo tên/id
 */
async function handleViewClass(bot, chatId, classIdentifier) {
  try {
    const classes = await firebase.getAllClasses();
    const classData = classes.find(c =>
      c.id.toLowerCase().includes(classIdentifier.toLowerCase()) ||
      c.display_name.toLowerCase().includes(classIdentifier.toLowerCase())
    );

    if (!classData) {
      await bot.sendMessage(chatId, `❌ Không tìm thấy lớp *${escMD(classIdentifier)}*\\.`, { parse_mode: 'MarkdownV2' });
      return;
    }

    const text = formatClassInfo(classData);
    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('handleViewClass error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi xem thông tin lớp\\.', { parse_mode: 'MarkdownV2' });
  }
}

module.exports = {
  handleSetup,
  handleListClasses,
  handleViewClass,
};
