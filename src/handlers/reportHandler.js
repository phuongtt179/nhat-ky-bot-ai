const firebase = require('../services/firebase');
const gemini = require('../services/gemini');
const { escMD, formatListWithIndex } = require('../utils/formatter');
const { formatMonthVN, formatMoney, currentMonth } = require('../utils/dateHelper');
const { saveLastList } = require('../utils/stateManager');
const { getMethodLabel } = require('./tuitionHandler');

/**
 * Entry point xử lý báo cáo
 */
async function handleReport(bot, chatId, type, month) {
  month = month || currentMonth();

  switch (type) {
    case 'chitieu':
      return await reportChiTieu(bot, chatId, month);
    case 'hocphi':
      return await reportHocPhi(bot, chatId, month);
    case 'diemdanh':
      return await reportDiemDanh(bot, chatId, month);
    case 'giangday':
      return await reportGiangDay(bot, chatId, month);
    case 'congviec':
      return await reportCongViec(bot, chatId, month);
    case 'thongke':
      return await reportThongKe(bot, chatId, month);
    case 'tonghop':
    default:
      return await reportTongHop(bot, chatId, month);
  }
}

/**
 * Báo cáo chi tiêu - phân loại theo category
 */
async function reportChiTieu(bot, chatId, month) {
  await bot.sendChatAction(chatId, 'typing');

  const entries = await firebase.getEntriesByTypeAndMonth('expense', month);

  if (entries.length === 0) {
    await bot.sendMessage(
      chatId,
      `💸 Không có chi tiêu nào trong ${escMD(formatMonthVN(month))}\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  // Nhóm theo category
  const byCategory = {};
  let total = 0;
  entries.forEach(e => {
    const cat = e.category || 'Khác';
    if (!byCategory[cat]) byCategory[cat] = { items: [], total: 0 };
    byCategory[cat].items.push(e);
    byCategory[cat].total += e.amount || 0;
    total += e.amount || 0;
  });

  let text = `💸 *CHI TIÊU ${escMD(formatMonthVN(month).toUpperCase())}*\n━━━━━━━━━━━━━━\n\n`;

  Object.entries(byCategory)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([cat, data]) => {
      text += `📂 *${escMD(cat)}* \\- ${escMD(formatMoney(data.total))}\n`;
      data.items.forEach((e, i) => {
        text += `   • ${escMD(e.title || e.content)} \\- ${escMD(formatMoney(e.amount))}`;
        if (e.date) text += ` \\(${escMD(e.date.split('-').slice(1).join('/'))}\\)`;
        text += '\n';
      });
      text += '\n';
    });

  text += `━━━━━━━━━━━━━━\n💰 *Tổng chi: ${escMD(formatMoney(total))}*`;

  // Lưu để sửa/xóa
  await saveLastList(entries.map(e => ({ id: e.id, display: e.title || e.content })));

  await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
}

/**
 * Báo cáo học phí - tổng hợp theo lớp
 */
async function reportHocPhi(bot, chatId, month) {
  await bot.sendChatAction(chatId, 'typing');

  const allClasses = await firebase.getAllClasses();
  const tuitionRecords = await firebase.getTuitionByMonth(month);

  let text = `💰 *HỌC PHÍ ${escMD(formatMonthVN(month).toUpperCase())}*\n━━━━━━━━━━━━━━\n\n`;

  let totalCollected = 0;
  let totalExpected = 0;
  let totalPending = 0;

  for (const classData of allClasses) {
    const classPaid = tuitionRecords.filter(r => r.class_id === classData.id);
    const paidAmount = classPaid.reduce((sum, r) => sum + (r.amount || 0), 0);
    const expectedAmount = classData.students.reduce((sum, s) => sum + (s.fee || 0), 0);

    const paidStudents = new Set(classPaid.map(r => r.student_id || r.student_name));
    const unpaidStudents = classData.students.filter(s =>
      !classPaid.some(r =>
        r.student_id === s.id ||
        r.student_name.toLowerCase().includes(s.name.toLowerCase().split(' ').pop())
      )
    );

    totalCollected += paidAmount;
    totalExpected += expectedAmount;
    totalPending += unpaidStudents.reduce((sum, s) => sum + (s.fee || 0), 0);

    text += `🏫 *${escMD(classData.display_name)}*\n`;
    text += `   ✅ Đã thu: ${classPaid.length}/${classData.students.length} em \\- ${escMD(formatMoney(paidAmount))}\n`;

    // Phân loại theo hình thức
    const byMethod = {};
    classPaid.forEach(r => {
      const m = r.method || 'other';
      byMethod[m] = (byMethod[m] || 0) + (r.amount || 0);
    });
    if (Object.keys(byMethod).length > 0) {
      const methodStr = Object.entries(byMethod)
        .map(([m, a]) => `${getMethodLabel(m)}: ${formatMoney(a)}`)
        .join(' \\| ');
      text += `   💳 ${escMD(methodStr)}\n`;
    }

    if (unpaidStudents.length > 0) {
      text += `   ❌ Chưa thu \\(${unpaidStudents.length} em\\): ${escMD(unpaidStudents.map(s => s.name).join(', '))}\n`;
    }
    text += '\n';
  }

  text += `━━━━━━━━━━━━━━\n`;
  text += `💚 *Đã thu: ${escMD(formatMoney(totalCollected))}*\n`;
  text += `💸 Còn thiếu: ${escMD(formatMoney(totalPending))}`;

  await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
}

/**
 * Báo cáo chuyên cần - vắng mặt từng lớp, từng em
 */
async function reportDiemDanh(bot, chatId, month) {
  await bot.sendChatAction(chatId, 'typing');

  const allClasses = await firebase.getAllClasses();
  const attendanceRecords = await firebase.getAttendanceByMonth(month);

  if (attendanceRecords.length === 0) {
    await bot.sendMessage(
      chatId,
      `📋 Không có dữ liệu điểm danh trong ${escMD(formatMonthVN(month))}\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  let text = `📋 *CHUYÊN CẦN ${escMD(formatMonthVN(month).toUpperCase())}*\n━━━━━━━━━━━━━━\n\n`;

  for (const classData of allClasses) {
    const classAttendance = attendanceRecords.filter(r => r.class_id === classData.id);
    if (classAttendance.length === 0) continue;

    text += `🏫 *${escMD(classData.display_name)}* \\(${classAttendance.length} buổi\\)\n`;

    // Đếm vắng theo học sinh
    const absentCount = {};
    classAttendance.forEach(record => {
      (record.absent || []).forEach(a => {
        const name = a.student_name;
        if (!absentCount[name]) absentCount[name] = { total: 0, phep: 0, khong_phep: 0 };
        absentCount[name].total++;
        if (a.type === 'phep') absentCount[name].phep++;
        else if (a.type === 'khong_phep') absentCount[name].khong_phep++;
      });
    });

    if (Object.keys(absentCount).length > 0) {
      // Sắp xếp theo số lần vắng
      const sorted = Object.entries(absentCount).sort((a, b) => b[1].total - a[1].total);
      sorted.forEach(([name, data]) => {
        text += `   • ${escMD(name)}: ${data.total} buổi`;
        if (data.phep > 0) text += ` \\(${data.phep} phép\\)`;
        if (data.khong_phep > 0) text += ` \\(${data.khong_phep} không phép\\)`;
        text += '\n';
      });
    } else {
      text += `   ✅ Không có học sinh nào vắng\n`;
    }
    text += '\n';
  }

  await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
}

/**
 * Báo cáo giảng dạy - số buổi, lớp, nội dung
 */
async function reportGiangDay(bot, chatId, month) {
  await bot.sendChatAction(chatId, 'typing');

  const [teachingEntries, attendanceRecords] = await Promise.all([
    firebase.getEntriesByTypeAndMonth('teaching', month),
    firebase.getAttendanceByMonth(month),
  ]);

  let text = `📚 *GIẢNG DẠY ${escMD(formatMonthVN(month).toUpperCase())}*\n━━━━━━━━━━━━━━\n\n`;

  // Thống kê từ attendance
  const allClasses = await firebase.getAllClasses();
  if (attendanceRecords.length > 0) {
    text += `*Số buổi đã dạy:*\n`;
    for (const classData of allClasses) {
      const count = attendanceRecords.filter(r => r.class_id === classData.id).length;
      if (count > 0) {
        text += `   🏫 ${escMD(classData.display_name)}: *${count} buổi*\n`;
      }
    }
    text += '\n';
  }

  // Teaching entries (ghi chép bài dạy)
  if (teachingEntries.length > 0) {
    text += `*Nội dung giảng dạy:*\n`;
    teachingEntries.forEach(e => {
      text += `   📖 ${escMD(e.title || e.content)}`;
      if (e.date) text += ` \\(${escMD(e.date.split('-').slice(1).join('/'))}\\)`;
      text += '\n';
    });
    text += '\n';
  }

  text += `📊 Tổng: *${attendanceRecords.length} buổi dạy*, ${teachingEntries.length} ghi chép`;

  await saveLastList(teachingEntries.map(e => ({ id: e.id, display: e.title || e.content })));
  await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
}

/**
 * Báo cáo công việc - task done/pending/cancelled
 */
async function reportCongViec(bot, chatId, month) {
  await bot.sendChatAction(chatId, 'typing');

  const entries = await firebase.getEntriesByTypeAndMonth('task', month);

  const done = entries.filter(e => e.status === 'done');
  const pending = entries.filter(e => ['pending', 'carried_over'].includes(e.status));
  const cancelled = entries.filter(e => e.status === 'cancelled');

  let text = `📝 *CÔNG VIỆC ${escMD(formatMonthVN(month).toUpperCase())}*\n━━━━━━━━━━━━━━\n\n`;
  text += `✅ Hoàn thành: ${done.length} \\| ⏳ Chưa xong: ${pending.length} \\| ❌ Hủy: ${cancelled.length}\n\n`;

  if (done.length > 0) {
    text += `*✅ Đã xong:*\n`;
    done.forEach(e => text += `   • ${escMD(e.title || e.content)}\n`);
    text += '\n';
  }

  if (pending.length > 0) {
    text += `*⏳ Chưa xong:*\n`;
    pending.forEach(e => {
      text += `   • ${escMD(e.title || e.content)}`;
      if (e.deadline) text += ` \\(hạn: ${escMD(e.deadline)}\\)`;
      text += '\n';
    });
    text += '\n';
  }

  if (cancelled.length > 0) {
    text += `*❌ Đã hủy:*\n`;
    cancelled.forEach(e => text += `   • ${escMD(e.title || e.content)}\n`);
  }

  const totalRate = entries.length > 0
    ? Math.round((done.length / entries.length) * 100)
    : 0;
  text += `\n📊 *Tỷ lệ hoàn thành: ${totalRate}%*`;

  await saveLastList(entries.map(e => ({ id: e.id, display: e.title || e.content })));
  await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
}

/**
 * Thống kê tổng hợp
 */
async function reportThongKe(bot, chatId, month) {
  await bot.sendChatAction(chatId, 'typing');

  const [entries, attendance, tuition, allClasses] = await Promise.all([
    firebase.getEntriesByMonth(month),
    firebase.getAttendanceByMonth(month),
    firebase.getTuitionByMonth(month),
    firebase.getAllClasses(),
  ]);

  const expenses = entries.filter(e => e.type === 'expense');
  const income = entries.filter(e => e.type === 'income');
  const tasks = entries.filter(e => e.type === 'task');
  const personal = entries.filter(e => e.type === 'personal');

  const totalExpense = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalIncome = income.reduce((s, e) => s + (e.amount || 0), 0);
  const totalTuition = tuition.reduce((s, t) => s + (t.amount || 0), 0);
  const tasksDone = tasks.filter(t => t.status === 'done').length;
  const taskRate = tasks.length > 0 ? Math.round(tasksDone / tasks.length * 100) : 0;

  let text = `📊 *THỐNG KÊ ${escMD(formatMonthVN(month).toUpperCase())}*\n━━━━━━━━━━━━━━\n\n`;

  text += `📅 *Tổng quan:*\n`;
  text += `   📝 Ghi chép: ${entries.length} mục\n`;
  text += `   🏫 Buổi dạy: ${attendance.length} buổi\n`;
  text += `   💭 Nhật ký cá nhân: ${personal.length} mục\n\n`;

  text += `💰 *Tài chính:*\n`;
  text += `   💵 Thu nhập: ${escMD(formatMoney(totalIncome))}\n`;
  text += `   💸 Chi tiêu: ${escMD(formatMoney(totalExpense))}\n`;
  text += `   💰 Học phí thu: ${escMD(formatMoney(totalTuition))}\n`;
  text += `   💚 Tiết kiệm: ${escMD(formatMoney(totalIncome + totalTuition - totalExpense))}\n\n`;

  text += `📝 *Công việc:*\n`;
  text += `   ✅ Hoàn thành: ${tasksDone}/${tasks.length} \\(${taskRate}%\\)\n\n`;

  if (allClasses.length > 0) {
    text += `🏫 *Lớp học:*\n`;
    for (const c of allClasses) {
      const sessions = attendance.filter(r => r.class_id === c.id).length;
      const paidCount = tuition.filter(t => t.class_id === c.id).length;
      text += `   • ${escMD(c.display_name)}: ${sessions} buổi \\| HP ${paidCount}/${c.students.length} em\n`;
    }
  }

  await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
}

/**
 * Báo cáo tổng hợp tất cả (dùng Gemini)
 */
async function reportTongHop(bot, chatId, month) {
  await bot.sendChatAction(chatId, 'typing');

  const [entries, attendance, tuition] = await Promise.all([
    firebase.getEntriesByMonth(month),
    firebase.getAttendanceByMonth(month),
    firebase.getTuitionByMonth(month),
  ]);

  const data = { entries, attendance, tuition };
  const report = await gemini.generateReport('tonghop', data, month);
  await bot.sendMessage(chatId, escMD(report), { parse_mode: 'MarkdownV2' });
}

module.exports = {
  handleReport,
  reportChiTieu,
  reportHocPhi,
  reportDiemDanh,
  reportGiangDay,
  reportCongViec,
  reportThongKe,
  reportTongHop,
};
