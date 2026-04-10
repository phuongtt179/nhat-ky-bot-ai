const cron = require('node-cron');
const firebase = require('./firebase');
const { formatMorningReminder, formatEveningReminder, escMD } = require('../utils/formatter');
const {
  today, tomorrow, currentMonth,
  todayDayName, tomorrowDayName,
  hasTodaySession, formatMonthVN,
} = require('../utils/dateHelper');

let botInstance = null;
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;

/**
 * Khởi động tất cả cron jobs
 */
function startScheduler(bot) {
  botInstance = bot;

  // Nhắc buổi sáng - 06:30 hàng ngày (giờ VN = UTC+7)
  cron.schedule('30 6 * * *', async () => {
    await sendMorningReminder();
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // Nhắc buổi tối (ngày mai) - 20:00 hàng ngày
  cron.schedule('0 20 * * *', async () => {
    await sendEveningReminder();
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // Weekly review - Chủ nhật 20:30
  cron.schedule('30 20 * * 0', async () => {
    await sendWeeklyReview();
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // Nhắc học phí cuối tháng - ngày 25 lúc 08:00
  cron.schedule('0 8 25 * *', async () => {
    await sendTuitionReminder();
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // Kiểm tra reminder của entries - mỗi 30 phút
  cron.schedule('*/30 * * * *', async () => {
    await checkEntryReminders();
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  console.log('✅ Scheduler đã khởi động');
}

/**
 * Gửi nhắc buổi sáng 06:30
 */
async function sendMorningReminder() {
  if (!botInstance || !OWNER_ID) return;

  try {
    const todayDate = today();
    const dayName = todayDayName();

    // Lấy entries hôm nay (schedule + task chưa xong)
    const entries = await firebase.getEntriesByDate(todayDate);
    const relevantEntries = entries.filter(e =>
      e.type === 'schedule' ||
      (e.type === 'task' && e.status !== 'done')
    );

    // Lấy lớp có lịch hôm nay
    const allClasses = await firebase.getAllClasses();
    const classesToday = allClasses.filter(c => hasTodaySession(c.sessions || []));

    // Kiểm tra hp chưa thu tháng này
    const month = currentMonth();
    const tuitionThisMonth = await firebase.getTuitionByMonth(month);
    const pendingTuitionClasses = [];

    for (const classData of allClasses) {
      const paidCount = tuitionThisMonth.filter(t => t.class_id === classData.id).length;
      if (paidCount < classData.students.length) {
        pendingTuitionClasses.push({
          name: classData.display_name,
          pending: classData.students.length - paidCount,
        });
      }
    }

    let text = formatMorningReminder(todayDate, dayName, relevantEntries, classesToday);

    // Thêm nhắc hp nếu có
    if (pendingTuitionClasses.length > 0) {
      text += `\n\n💰 *Hp chưa thu:*\n`;
      pendingTuitionClasses.forEach(c => {
        text += `   • ${escMD(c.name)}: còn ${c.pending} em\n`;
      });
    }

    await botInstance.sendMessage(OWNER_ID, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('sendMorningReminder error:', err);
  }
}

/**
 * Gửi nhắc buổi tối 20:00 (cho ngày mai)
 */
async function sendEveningReminder() {
  if (!botInstance || !OWNER_ID) return;

  try {
    const tomorrowDate = tomorrow();
    const tomorrowDay = getTomorrowDayName();

    // Entries ngày mai có reminder day_before
    const tomorrowEntries = await firebase.getEntriesByDate(tomorrowDate);
    const scheduleEntries = tomorrowEntries.filter(e => e.type === 'schedule');

    // Lớp có lịch ngày mai
    const allClasses = await firebase.getAllClasses();
    const { DAY_TO_SESSION } = require('../utils/dateHelper');
    const tomorrowDayNum = new Date(tomorrowDate).getDay();
    const tomorrowSession = DAY_TO_SESSION[tomorrowDayNum];
    const classesTomorrow = allClasses.filter(c =>
      (c.sessions || []).includes(tomorrowSession)
    );

    // Chỉ gửi nếu có lịch hoặc lớp
    if (scheduleEntries.length === 0 && classesTomorrow.length === 0) return;

    const text = formatEveningReminder(tomorrowDate, tomorrowDay, scheduleEntries, classesTomorrow);
    await botInstance.sendMessage(OWNER_ID, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('sendEveningReminder error:', err);
  }
}

/**
 * Gửi weekly review Chủ nhật 20:30
 */
async function sendWeeklyReview() {
  if (!botInstance || !OWNER_ID) return;

  try {
    const { currentWeek, getWeekRange } = require('../utils/dateHelper');
    const week = currentWeek();
    const { start, end, label } = getWeekRange();

    const [entries, attendance, tuition] = await Promise.all([
      firebase.getEntriesByWeek(week),
      firebase.getAttendanceByMonth(currentMonth()),
      firebase.getTuitionByMonth(currentMonth()),
    ]);

    const gemini = require('./gemini');
    const review = await gemini.generateWeeklyReview(entries, attendance, tuition, label);

    if (!review) return;

    let text = review.summary_text || '';

    // Thêm inline keyboard để hỏi chuyện tồn
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Tuần tốt!', callback_data: 'review_good' },
          { text: '😔 Tuần mệt', callback_data: 'review_tired' },
        ],
        [{ text: '📊 Xem báo cáo tuần', callback_data: 'review_report' }],
      ],
    };

    await botInstance.sendMessage(OWNER_ID, `🗓️ *TỔNG KẾT TUẦN ${escMD(label)}*\n\n${escMD(text)}`, {
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error('sendWeeklyReview error:', err);
  }
}

/**
 * Gửi nhắc học phí cuối tháng (ngày 25)
 */
async function sendTuitionReminder() {
  if (!botInstance || !OWNER_ID) return;

  try {
    const month = currentMonth();
    const allClasses = await firebase.getAllClasses();
    const tuitionRecords = await firebase.getTuitionByMonth(month);

    let totalPending = 0;
    let pendingDetails = [];

    for (const classData of allClasses) {
      const unpaidStudents = classData.students.filter(s =>
        !tuitionRecords.some(r =>
          r.class_id === classData.id && (
            r.student_id === s.id ||
            r.student_name.toLowerCase().includes(s.name.toLowerCase().split(' ').pop())
          )
        )
      );

      if (unpaidStudents.length > 0) {
        totalPending += unpaidStudents.length;
        pendingDetails.push({
          class: classData.display_name,
          count: unpaidStudents.length,
          amount: unpaidStudents.reduce((sum, s) => sum + (s.fee || 0), 0),
        });
      }
    }

    if (totalPending === 0) return; // Tất cả đã đóng

    let text = `💰 *Nhắc học phí ${escMD(formatMonthVN(month))}*\n━━━━━━━━━━━━━━\n`;
    text += `\n📌 Còn *${totalPending} em* chưa đóng hp:\n\n`;

    pendingDetails.forEach(d => {
      const { formatMoney } = require('../utils/dateHelper');
      text += `🏫 ${escMD(d.class)}: ${d.count} em \\- ${escMD(formatMoney(d.amount))}\n`;
    });

    text += `\nDùng /hocphi để xem chi tiết\\.`;

    await botInstance.sendMessage(OWNER_ID, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('sendTuitionReminder error:', err);
  }
}

/**
 * Kiểm tra và gửi reminder của các entries
 */
async function checkEntryReminders() {
  if (!botInstance || !OWNER_ID) return;

  try {
    const todayDate = today();
    const currentHour = new Date().toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).substring(0, 5);

    // Lấy entries có reminder ngày mai (day_before)
    const tomorrowDate = tomorrow();
    const tomorrowEntries = await firebase.getEntriesWithReminder(tomorrowDate);

    for (const entry of tomorrowEntries) {
      const dayBeforeReminders = (entry.reminder || []).filter(
        r => r.type === 'day_before' && !r.sent
      );

      for (const reminder of dayBeforeReminders) {
        if (reminder.time && currentHour >= reminder.time) {
          await botInstance.sendMessage(
            OWNER_ID,
            `🔔 *Nhắc ngày mai:* ${escMD(entry.title || entry.content)}\n📅 ${escMD(tomorrowDate)}`,
            { parse_mode: 'MarkdownV2' }
          );

          // Mark as sent
          const updatedReminders = (entry.reminder || []).map(r =>
            r.type === 'day_before' && !r.sent ? { ...r, sent: true } : r
          );
          await firebase.updateEntry(entry.id, { reminder: updatedReminders });
        }
      }
    }

    // Lấy entries hôm nay có reminder morning
    const todayEntries = await firebase.getEntriesWithReminder(todayDate);
    for (const entry of todayEntries) {
      const morningReminders = (entry.reminder || []).filter(
        r => r.type === 'morning' && !r.sent
      );

      for (const reminder of morningReminders) {
        if (currentHour >= '06:30') {
          await botInstance.sendMessage(
            OWNER_ID,
            `⏰ *Lịch hôm nay:* ${escMD(entry.title || entry.content)}`,
            { parse_mode: 'MarkdownV2' }
          );

          const updatedReminders = (entry.reminder || []).map(r =>
            r.type === 'morning' && !r.sent ? { ...r, sent: true } : r
          );
          await firebase.updateEntry(entry.id, { reminder: updatedReminders });
        }
      }
    }
  } catch (err) {
    console.error('checkEntryReminders error:', err);
  }
}

/**
 * Lấy tên thứ ngày mai tiếng Việt
 */
function getTomorrowDayName() {
  const { DAY_NAMES_VN } = require('../utils/dateHelper');
  const tomorrowDay = new Date();
  tomorrowDay.setDate(tomorrowDay.getDate() + 1);
  return DAY_NAMES_VN[tomorrowDay.getDay()];
}

module.exports = { startScheduler };
