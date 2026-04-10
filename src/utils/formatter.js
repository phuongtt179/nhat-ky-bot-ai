const { formatDateVN, formatMonthVN, formatMoney, sessionToDisplayName } = require('./dateHelper');

/**
 * Escape ký tự đặc biệt Markdown v2 của Telegram
 */
function escMD(text) {
  if (!text && text !== 0) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

/**
 * Format xác nhận trước khi lưu entry
 */
function formatConfirmation(items) {
  if (!items || items.length === 0) return 'Không có dữ liệu để xác nhận.';

  const lines = items.map((item, i) => {
    const typeEmoji = getTypeEmoji(item.type);
    let line = `${typeEmoji} *${escMD(item.title || item.content)}*`;
    if (item.date) line += `\n   📅 ${escMD(formatDateVN(item.date))}`;
    if (item.amount) line += `\n   💰 ${escMD(formatMoney(item.amount))}`;
    if (item.class_id) line += `\n   🏫 ${escMD(item.class_id)}`;
    if (item.deadline) line += `\n   ⏰ Hạn: ${escMD(item.deadline)}`;
    return line;
  });

  return lines.join('\n\n') + '\n\n✅ Lưu lại không\\? \\(ok/không\\)';
}

/**
 * Format danh sách entries có đánh số để chỉnh sửa
 */
function formatListWithIndex(items) {
  if (!items || items.length === 0) return 'Không có dữ liệu.';

  const lines = items.map((item, i) => {
    const typeEmoji = getTypeEmoji(item.type);
    const num = `\\[${i + 1}\\]`;
    let line = `${num} ${typeEmoji} ${escMD(item.title || item.content)}`;
    if (item.date) line += ` \\| ${escMD(item.date)}`;
    if (item.amount) line += ` \\| ${escMD(formatMoney(item.amount))}`;
    if (item.status && item.status !== 'done') line += ` \\| _${escMD(item.status)}_`;
    return line;
  });

  return lines.join('\n') + '\n\n✏️ Gõ "sửa \\[số\\]" hoặc "xóa \\[số\\]"';
}

/**
 * Format điểm danh
 */
function formatAttendance(data) {
  const { className, dayName, date, session, present, total, absent } = data;

  let text = `✅ *Điểm danh ${escMD(className)}*\n`;
  text += `📅 ${escMD(dayName)}, ${escMD(date)}\n`;
  text += `🕐 Buổi học: ${escMD(sessionToDisplayName(session))}\n`;
  text += `👥 Có mặt: ${present}/${total} em\n`;

  if (absent && absent.length > 0) {
    text += `\n❌ *Vắng:*\n`;
    absent.forEach(a => {
      const reason = a.type === 'phep' ? ' \\(có phép\\)' : a.type === 'khong_phep' ? ' \\(không phép\\)' : '';
      text += `   • ${escMD(a.student_name)}${reason}\n`;
    });
  }

  return text;
}

/**
 * Format học phí còn thiếu
 */
function formatTuitionPending(data) {
  const { month, className, paid, total, pending, remaining } = data;

  let text = `💰 *HỌC PHÍ ${escMD(formatMonthVN(month))} \\- ${escMD(className)}*\n`;
  text += `━━━━━━━━━━━━━━\n`;
  text += `✅ Đã đóng: ${paid}/${total} em\n`;

  if (pending && pending.length > 0) {
    text += `❌ Chưa đóng \\(${pending.length} em\\):\n`;
    pending.forEach(s => {
      text += `   • ${escMD(s.name)} \\- ${escMD(formatMoney(s.fee))}\n`;
    });
  }

  text += `\n💚 Còn thiếu: *${escMD(formatMoney(remaining))}*`;
  return text;
}

/**
 * Format thông tin lớp học
 */
function formatClassInfo(classData) {
  const { display_name, subject, sessions, students } = classData;

  let text = `🏫 *${escMD(display_name)}*\n`;
  text += `📚 Môn: ${escMD(subject)}\n`;
  text += `📅 Lịch: ${sessions.map(s => escMD(sessionToDisplayName(s))).join(', ')}\n`;
  text += `👥 Sĩ số: ${students?.length || 0} em\n\n`;

  if (students && students.length > 0) {
    text += `*Danh sách học sinh:*\n`;
    students.forEach((s, i) => {
      text += `${i + 1}\\. ${escMD(s.name)}`;
      if (s.fee) text += ` \\- ${escMD(formatMoney(s.fee))}`;
      if (s.sessions && s.sessions.length !== sessions.length) {
        text += ` \\(${s.sessions.map(ss => escMD(sessionToDisplayName(ss))).join(', ')}\\)`;
      }
      text += '\n';
    });
  }

  return text;
}

/**
 * Format lịch hôm nay
 */
function formatToday(date, dayName, entries, classes) {
  let text = `🌅 *${escMD(dayName)}, ${escMD(date)}*\n`;
  text += `━━━━━━━━━━━━━━\n`;

  // Lớp có lịch hôm nay
  if (classes && classes.length > 0) {
    text += `\n🏫 *Lớp hôm nay:*\n`;
    classes.forEach(c => {
      text += `   • ${escMD(c.display_name)}\n`;
    });
  }

  // Lịch và sự kiện
  const schedules = entries.filter(e => e.type === 'schedule');
  if (schedules.length > 0) {
    text += `\n📅 *Lịch:*\n`;
    schedules.forEach(e => {
      text += `   • ${escMD(e.title || e.content)}\n`;
    });
  }

  // Tasks chưa xong
  const tasks = entries.filter(e => e.type === 'task' && e.status !== 'done');
  if (tasks.length > 0) {
    text += `\n📝 *Việc cần làm:*\n`;
    tasks.forEach(e => {
      const priority = e.priority === 'high' ? '🔴' : e.priority === 'medium' ? '🟡' : '🟢';
      text += `   ${priority} ${escMD(e.title || e.content)}\n`;
    });
  }

  if (schedules.length === 0 && tasks.length === 0 && (!classes || classes.length === 0)) {
    text += `\n😌 Hôm nay không có lịch gì đặc biệt\\.`;
  }

  return text;
}

/**
 * Format lịch cả tuần
 */
function formatWeek(weekLabel, dailyData) {
  let text = `📅 *Lịch tuần \\(${escMD(weekLabel)}\\)*\n`;
  text += `━━━━━━━━━━━━━━\n\n`;

  Object.entries(dailyData).forEach(([dayName, data]) => {
    text += `*${escMD(dayName)}*`;
    if (data.date) text += ` \\(${escMD(data.date)}\\)`;
    text += '\n';

    if (data.classes && data.classes.length > 0) {
      data.classes.forEach(c => {
        text += `   🏫 ${escMD(c.display_name)}\n`;
      });
    }
    if (data.entries && data.entries.length > 0) {
      data.entries.forEach(e => {
        text += `   ${getTypeEmoji(e.type)} ${escMD(e.title || e.content)}\n`;
      });
    }
    if ((!data.classes || data.classes.length === 0) && (!data.entries || data.entries.length === 0)) {
      text += `   _\\(không có lịch\\)_\n`;
    }
    text += '\n';
  });

  return text;
}

/**
 * Format tasks còn lại (conlai)
 */
function formatPendingTasks(tasks) {
  if (!tasks || tasks.length === 0) {
    return '✅ Không có việc gì chưa xong\\! Tuyệt vời\\!';
  }

  const overdue = tasks.filter(t => t.deadline && t.deadline < new Date().toISOString().split('T')[0]);
  const upcoming = tasks.filter(t => t.deadline && t.deadline >= new Date().toISOString().split('T')[0]);
  const noDeadline = tasks.filter(t => !t.deadline);

  let text = `📝 *Việc chưa xong \\(${tasks.length}\\)*\n━━━━━━━━━━━━━━\n`;

  if (overdue.length > 0) {
    text += `\n🔴 *Quá hạn \\(${overdue.length}\\):*\n`;
    overdue.forEach((t, i) => {
      text += `\\[${i + 1}\\] ${escMD(t.title || t.content)} \\| hạn ${escMD(t.deadline)}\n`;
    });
  }

  if (upcoming.length > 0) {
    text += `\n🟡 *Sắp đến hạn \\(${upcoming.length}\\):*\n`;
    upcoming.forEach((t, i) => {
      text += `\\[${overdue.length + i + 1}\\] ${escMD(t.title || t.content)} \\| hạn ${escMD(t.deadline)}\n`;
    });
  }

  if (noDeadline.length > 0) {
    text += `\n🟢 *Không có hạn \\(${noDeadline.length}\\):*\n`;
    noDeadline.forEach((t, i) => {
      text += `\\[${overdue.length + upcoming.length + i + 1}\\] ${escMD(t.title || t.content)}\n`;
    });
  }

  text += '\n✏️ Gõ "sửa \\[số\\]" hoặc "xóa \\[số\\]"';
  return text;
}

/**
 * Format nhắc lịch buổi sáng
 */
function formatMorningReminder(date, dayName, entries, classesToday) {
  let text = `☀️ *Chào buổi sáng\\!*\n`;
  text += `📅 ${escMD(dayName)}, ${escMD(date)}\n━━━━━━━━━━━━━━\n`;

  if (classesToday.length > 0) {
    text += `\n🏫 *Hôm nay dạy:*\n`;
    classesToday.forEach(c => text += `   • ${escMD(c.display_name)}\n`);
  }

  const todayEntries = entries.filter(e => ['schedule', 'task'].includes(e.type));
  if (todayEntries.length > 0) {
    text += `\n📋 *Lịch hôm nay:*\n`;
    todayEntries.forEach(e => {
      text += `   ${getTypeEmoji(e.type)} ${escMD(e.title || e.content)}\n`;
    });
  }

  return text;
}

/**
 * Format nhắc lịch buổi tối (ngày mai)
 */
function formatEveningReminder(tomorrowDate, tomorrowDayName, entries, classesTomorrow) {
  let text = `🌙 *Ngày mai bạn có:*\n`;
  text += `📅 ${escMD(tomorrowDayName)}, ${escMD(tomorrowDate)}\n━━━━━━━━━━━━━━\n`;

  if (classesTomorrow.length > 0) {
    text += `\n🏫 *Lớp dạy:*\n`;
    classesTomorrow.forEach(c => text += `   • ${escMD(c.display_name)}\n`);
  }

  if (entries.length > 0) {
    text += `\n📋 *Lịch:*\n`;
    entries.forEach(e => {
      text += `   ${getTypeEmoji(e.type)} ${escMD(e.title || e.content)}\n`;
    });
  }

  if (classesTomorrow.length === 0 && entries.length === 0) {
    text += `\n😌 Ngày mai không có lịch gì\\.`;
  }

  return text;
}

/**
 * Lấy emoji theo loại entry
 */
function getTypeEmoji(type) {
  const map = {
    expense: '💸',
    income: '💵',
    teaching: '📚',
    schedule: '📅',
    task: '📝',
    activity: '⚡',
    personal: '💭',
    attendance: '✅',
    tuition: '💰',
    mixed: '📌',
  };
  return map[type] || '📌';
}

/**
 * Format entry đơn để hiển thị
 */
function formatEntry(entry) {
  const emoji = getTypeEmoji(entry.type);
  let text = `${emoji} *${escMD(entry.title || entry.content)}*\n`;
  if (entry.date) text += `📅 ${escMD(formatDateVN(entry.date))}\n`;
  if (entry.content && entry.title && entry.content !== entry.title) {
    text += `📄 ${escMD(entry.content)}\n`;
  }
  if (entry.amount) text += `💰 ${escMD(formatMoney(entry.amount))}\n`;
  if (entry.class_id) text += `🏫 ${escMD(entry.class_id)}\n`;
  if (entry.status && entry.status !== 'done') text += `📊 ${escMD(entry.status)}\n`;
  if (entry.deadline) text += `⏰ Hạn: ${escMD(entry.deadline)}\n`;
  return text;
}

/**
 * Escape text thông thường để gửi Markdown
 */
function safeText(text) {
  return escMD(String(text || ''));
}

module.exports = {
  escMD,
  safeText,
  formatConfirmation,
  formatListWithIndex,
  formatAttendance,
  formatTuitionPending,
  formatClassInfo,
  formatToday,
  formatWeek,
  formatPendingTasks,
  formatMorningReminder,
  formatEveningReminder,
  formatEntry,
  getTypeEmoji,
};
