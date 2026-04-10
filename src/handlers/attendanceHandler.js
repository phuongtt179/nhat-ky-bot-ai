const firebase = require('../services/firebase');
const gemini = require('../services/gemini');
const { formatAttendance, escMD } = require('../utils/formatter');
const { today, currentMonth, todaySession, sessionToDisplayName, formatDateVN } = require('../utils/dateHelper');
const { setAttendanceClarify, setConfirmingSave, resetToChat, saveLastAction } = require('../utils/stateManager');

/**
 * Xử lý điểm danh thông minh
 * Phát hiện từ messageHandler khi message có pattern điểm danh
 */
async function handleAttendance(bot, msg, text, parsedFromGemini) {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    // Xác định lớp học từ kết quả parse của Gemini
    const className = parsedFromGemini?.class_name || parsedFromGemini?.items?.[0]?.class_id;
    if (!className) {
      await bot.sendMessage(chatId, 'Bạn muốn điểm danh lớp nào vậy? 🤔', { parse_mode: 'MarkdownV2' });
      return;
    }

    // Tìm lớp phù hợp trong database
    const allClasses = await firebase.getAllClasses();
    const classData = findMatchingClass(allClasses, className);

    if (!classData) {
      await bot.sendMessage(
        chatId,
        `❌ Không tìm thấy lớp *${escMD(className)}*\\. Bạn kiểm tra lại tên lớp nhé\\!`,
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // Phân tích chi tiết điểm danh bằng Gemini
    const attendance = await gemini.parseAttendance(text, classData);
    if (!attendance) {
      await bot.sendMessage(chatId, 'Mình không phân tích được thông tin điểm danh\\. Bạn thử lại nhé\\!', { parse_mode: 'MarkdownV2' });
      return;
    }

    // Xác định buổi học
    const todaySess = todaySession();
    let session = attendance.session_hint || todaySess;

    // Nếu hôm nay không có lịch lớp này → hỏi buổi nào
    const hasSessionToday = classData.sessions?.includes(todaySess);
    if (!hasSessionToday && !attendance.session_hint) {
      await setAttendanceClarify({
        class_id: classData.id,
        class_data: classData,
        attendance_parsed: attendance,
        original_text: text,
      });

      const sessionOptions = classData.sessions
        .map(s => sessionToDisplayName(s))
        .join(' hoặc ');

      await bot.sendMessage(
        chatId,
        `📅 Hôm nay ${escMD(classData.display_name)} không có lịch\\.\nBạn muốn điểm danh buổi *${escMD(sessionOptions)}*?`,
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // Lọc học sinh có lịch buổi hôm nay
    const studentsToday = classData.students?.filter(s =>
      s.sessions?.includes(session) || classData.sessions?.includes(session)
    ) || classData.students || [];

    // Xử lý "đủ hết" - tất cả có mặt
    if (attendance.present_all) {
      await confirmAttendance(bot, chatId, {
        classData,
        session,
        date: today(),
        students: studentsToday,
        absent: [],
        note: attendance.note,
      });
      return;
    }

    // Match tên vắng với danh sách học sinh
    if (attendance.absent_names && attendance.absent_names.length > 0) {
      const matched = await gemini.matchStudentNames(attendance.absent_names, studentsToday);

      // Kiểm tra trường hợp ambiguous (trùng tên)
      const ambiguous = matched.filter(m => m.ambiguous);
      if (ambiguous.length > 0) {
        await setAttendanceClarify({
          class_id: classData.id,
          class_data: classData,
          session,
          matched,
          attendance_parsed: attendance,
          waiting_for: 'name_clarify',
        });

        const question = ambiguous.map(a =>
          `*${escMD(a.input_name)}*: ${a.candidates.map(c => escMD(c)).join(' hay ')}`
        ).join('\n');

        await bot.sendMessage(
          chatId,
          `❓ Có tên trùng, bạn xác nhận giúp mình:\n${question}`,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      // Cảnh báo tên không tìm thấy
      const notFound = matched.filter(m => !m.matched_id && m.confidence === 'low');
      if (notFound.length > 0) {
        const names = notFound.map(m => `*${escMD(m.input_name)}*`).join(', ');
        await bot.sendMessage(
          chatId,
          `⚠️ Không tìm thấy: ${names} trong lớp ${escMD(classData.display_name)}\nMình bỏ qua những tên này và tiếp tục\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      }

      // Tạo danh sách vắng đã match
      const absent = matched
        .filter(m => m.matched_id)
        .map(m => ({
          student_id: m.matched_id,
          student_name: m.matched_name,
          type: attendance.absent_reasons?.[m.input_name] || null,
          note: '',
          pre_reported: attendance.pre_reported || false,
        }));

      await confirmAttendance(bot, chatId, {
        classData,
        session,
        date: today(),
        students: studentsToday,
        absent,
        note: attendance.note,
      });
    }
  } catch (err) {
    console.error('attendanceHandler error:', err);
    await bot.sendMessage(chatId, 'Có lỗi xảy ra khi điểm danh\\. Bạn thử lại nhé\\!', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Hiển thị xác nhận điểm danh trước khi lưu
 */
async function confirmAttendance(bot, chatId, data) {
  const { classData, session, date, students, absent, note } = data;
  const present = students.length - absent.length;

  const text = formatAttendance({
    className: classData.display_name,
    dayName: new Date(date).toLocaleDateString('vi-VN', { weekday: 'long' }),
    date: date.split('-').reverse().join('/'),
    session,
    present,
    total: students.length,
    absent,
  });

  await setConfirmingSave({
    type: 'attendance',
    class_id: classData.id,
    class_name: classData.display_name,
    session,
    date,
    month: date.substring(0, 7),
    week: getWeekString(date),
    total_students: students.length,
    present_count: present,
    absent,
    note: note || '',
  });

  await bot.sendMessage(chatId, text + '\n\n✅ Lưu lại không\\? \\(ok/không\\)', { parse_mode: 'MarkdownV2' });
}

/**
 * Xử lý clarify buổi học (khi hỏi buổi nào)
 */
async function handleAttendanceClarify(bot, msg, session) {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || '';
  const pendingData = session.pending_data;

  try {
    if (pendingData.waiting_for === 'name_clarify') {
      // Đang hỏi tên trùng - chưa implement đầy đủ, bỏ qua
      await resetToChat();
      await bot.sendMessage(chatId, 'Bạn xác nhận lại tên học sinh vắng nhé\\!', { parse_mode: 'MarkdownV2' });
      return;
    }

    // Đang hỏi buổi học nào
    const { class_data, attendance_parsed } = pendingData;
    const { DAY_MAP } = require('../utils/dateHelper');

    // Tìm session từ câu trả lời
    const lowerText = text.toLowerCase();
    let chosenSession = null;
    for (const [key, val] of Object.entries(DAY_MAP)) {
      if (lowerText.includes(key) || lowerText.includes(sessionToDisplayName(key).toLowerCase())) {
        chosenSession = key;
        break;
      }
    }

    if (!chosenSession) {
      await bot.sendMessage(chatId, 'Mình chưa hiểu buổi nào\\. Bạn gõ ví dụ "thứ 3" hoặc "thứ 6" nhé\\!', { parse_mode: 'MarkdownV2' });
      return;
    }

    await resetToChat();

    const studentsToday = class_data.students?.filter(s =>
      s.sessions?.includes(chosenSession)
    ) || class_data.students || [];

    // Match tên vắng
    const matched = await gemini.matchStudentNames(
      attendance_parsed.absent_names || [],
      studentsToday
    );

    const absent = matched
      .filter(m => m.matched_id)
      .map(m => ({
        student_id: m.matched_id,
        student_name: m.matched_name,
        type: attendance_parsed.absent_reasons?.[m.input_name] || null,
        note: '',
        pre_reported: false,
      }));

    await confirmAttendance(bot, chatId, {
      classData: class_data,
      session: chosenSession,
      date: today(),
      students: studentsToday,
      absent,
      note: attendance_parsed.note,
    });
  } catch (err) {
    console.error('handleAttendanceClarify error:', err);
    await resetToChat();
    await bot.sendMessage(chatId, 'Có lỗi xảy ra\\. Bạn thử điểm danh lại nhé\\!', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Lưu điểm danh vào Firestore sau khi xác nhận
 */
async function saveAttendanceRecord(pendingData) {
  const record = await firebase.saveAttendance(pendingData);
  await saveLastAction({
    type: 'save_attendance',
    record_id: record.id,
    data: pendingData,
  });
  return record;
}

/**
 * Tra cứu điểm danh theo câu hỏi
 */
async function queryAttendance(bot, chatId, query, params) {
  try {
    await bot.sendChatAction(chatId, 'typing');

    const { month, class_id, student_name } = params;
    let results = [];

    if (class_id && month) {
      results = await firebase.getAttendanceByClassAndMonth(class_id, month);
    } else if (month) {
      results = await firebase.getAttendanceByMonth(month);
    }

    if (results.length === 0) {
      await bot.sendMessage(chatId, `📊 Không tìm thấy dữ liệu điểm danh\\. Bạn thử tháng khác nhé\\!`, { parse_mode: 'MarkdownV2' });
      return;
    }

    const answer = await gemini.searchAndAnswer({ attendance: results }, query);
    await bot.sendMessage(chatId, escMD(answer), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('queryAttendance error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi tra cứu điểm danh\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Tìm lớp phù hợp từ tên (tìm gần đúng)
 */
function findMatchingClass(allClasses, name) {
  if (!name) return null;
  const lower = name.toLowerCase().replace(/\s+/g, '');
  return allClasses.find(c =>
    c.id.toLowerCase().replace(/\s+/g, '').includes(lower) ||
    c.display_name.toLowerCase().replace(/\s+/g, '').includes(lower) ||
    lower.includes(c.id.toLowerCase().replace(/\s+/g, '')) ||
    lower.includes(c.display_name.toLowerCase().replace(/\s+/g, ''))
  ) || null;
}

/**
 * Tính week string từ date
 */
function getWeekString(dateStr) {
  const d = new Date(dateStr);
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

module.exports = {
  handleAttendance,
  handleAttendanceClarify,
  saveAttendanceRecord,
  queryAttendance,
  findMatchingClass,
};
