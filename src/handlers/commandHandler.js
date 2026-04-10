const firebase = require('../services/firebase');
const gemini = require('../services/gemini');
const { formatToday, formatWeek, formatPendingTasks, escMD } = require('../utils/formatter');
const {
  today, tomorrow, currentMonth, currentWeek,
  todayDayName, todaySession, getWeekRange,
  getSessionDatesThisWeek, hasTodaySession,
  formatMonthVN, formatDateVN,
} = require('../utils/dateHelper');
const { saveLastList, saveLastAction, getLastAction, resetToChat } = require('../utils/stateManager');
const { handleListClasses } = require('./setupHandler');
const { showTuitionOverview } = require('./tuitionHandler');
const { handleDiarySummary, handleNaturalSearch } = require('./messageHandler');

/**
 * Đăng ký tất cả các lệnh / cho bot
 */
function registerCommands(bot) {
  bot.onText(/\/start/, (msg) => handleStart(bot, msg));
  bot.onText(/\/homnay/, (msg) => handleHomNay(bot, msg));
  bot.onText(/\/tuannay/, (msg) => handleTuanNay(bot, msg));
  bot.onText(/\/conlai/, (msg) => handleConLai(bot, msg));
  bot.onText(/\/baocao(.*)/, (msg, match) => handleBaoCao(bot, msg, match[1]?.trim()));
  bot.onText(/\/thongke(.*)/, (msg, match) => handleThongKe(bot, msg, match[1]?.trim()));
  bot.onText(/\/timkiem(.*)/, (msg, match) => handleTimKiem(bot, msg, match[1]?.trim()));
  bot.onText(/\/hoantac/, (msg) => handleHoanTac(bot, msg));
  bot.onText(/\/huongdan/, (msg) => handleHuongDan(bot, msg));
  bot.onText(/\/danhsach/, (msg) => handleDanhSach(bot, msg));
  bot.onText(/\/hocphi(.*)/, (msg, match) => handleHocPhi(bot, msg, match[1]?.trim()));
}

/**
 * /start - Chào mừng
 */
async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'bạn';

  const text = `👋 Chào *${escMD(name)}*\\! Mình là trợ lý nhật ký AI của bạn\\.

Mình có thể giúp bạn:
📝 Ghi chép mọi hoạt động hàng ngày
🏫 Quản lý lớp học và điểm danh
💰 Theo dõi học phí
📅 Nhắc lịch tự động
📊 Tổng hợp báo cáo

*Bắt đầu bằng cách nhắn tin tự nhiên như với người bạn nhé\\!*

Gõ /huongdan để xem hướng dẫn đầy đủ\\.`;

  await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
}

/**
 * /homnay - Lịch hôm nay
 */
async function handleHomNay(bot, msg) {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    const todayDate = today();
    const dayName = todayDayName();
    const todaySess = todaySession();

    // Lấy entries hôm nay
    const entries = await firebase.getEntriesByDate(todayDate);

    // Lấy lớp có lịch hôm nay
    const allClasses = await firebase.getAllClasses();
    const classesToday = allClasses.filter(c =>
      hasTodaySession(c.sessions || [])
    );

    const text = formatToday(todayDate, dayName, entries, classesToday);

    // Lưu vào last_list để có thể sửa/xóa
    const listItems = entries.map(e => ({ id: e.id, display: e.title || e.content, type: e.type }));
    await saveLastList(listItems);

    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('handleHomNay error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi lấy lịch hôm nay\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * /tuannay - Lịch cả tuần
 */
async function handleTuanNay(bot, msg) {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    const { start, end, label } = getWeekRange();
    const allClasses = await firebase.getAllClasses();

    // Tạo data cho từng ngày trong tuần
    const dayNames = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'];
    const sessionKeys = ['thu_2', 'thu_3', 'thu_4', 'thu_5', 'thu_6', 'thu_7', 'chu_nhat'];

    const dailyData = {};
    const weekEntries = await firebase.getEntriesByWeek(currentWeek());

    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const sessionKey = sessionKeys[i];

      const dayClasses = allClasses.filter(c => (c.sessions || []).includes(sessionKey));
      const dayEntries = weekEntries.filter(e => e.date === dateStr);

      dailyData[dayNames[i]] = {
        date: dateStr.split('-').reverse().join('/'),
        classes: dayClasses,
        entries: dayEntries,
      };
    }

    const text = formatWeek(label, dailyData);
    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('handleTuanNay error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi lấy lịch tuần\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * /conlai - Việc chưa xong
 */
async function handleConLai(bot, msg) {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    const tasks = await firebase.getPendingTasks();
    const text = formatPendingTasks(tasks);

    // Lưu vào last_list để sửa/xóa
    const listItems = tasks.map(t => ({ id: t.id, display: t.title || t.content, type: t.type }));
    await saveLastList(listItems);

    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('handleConLai error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi lấy danh sách việc chưa xong\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * /baocao [loại] [tháng] - Báo cáo
 * Ví dụ: /baocao chitieu thang3, /baocao hocphi, /baocao thang3
 */
async function handleBaoCao(bot, msg, args) {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    if (!args) {
      // Hiện menu chọn loại báo cáo
      const menu = `📊 *Báo cáo* \\- chọn loại:\n\n` +
        `/baocao chitieu thang3\n` +
        `/baocao hocphi thang3\n` +
        `/baocao diemdanh thang3\n` +
        `/baocao giangday thang3\n` +
        `/baocao congviec thang3\n` +
        `/baocao thang3 \\(tổng hợp\\)`;
      await bot.sendMessage(chatId, menu, { parse_mode: 'MarkdownV2' });
      return;
    }

    // Parse args
    const { type, month } = parseReportArgs(args);
    const { handleReport } = require('./reportHandler');
    await handleReport(bot, chatId, type, month);
  } catch (err) {
    console.error('handleBaoCao error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi tạo báo cáo\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * /thongke [tháng] - Thống kê hiệu suất
 */
async function handleThongKe(bot, msg, args) {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');
    const month = parseMonthArg(args) || currentMonth();
    const { handleReport } = require('./reportHandler');
    await handleReport(bot, chatId, 'thongke', month);
  } catch (err) {
    console.error('handleThongKe error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi tạo thống kê\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * /timkiem [từ khóa] - Tìm kiếm tự nhiên
 */
async function handleTimKiem(bot, msg, query) {
  const chatId = msg.chat.id;

  if (!query) {
    await bot.sendMessage(
      chatId,
      '🔍 Bạn muốn tìm gì\\? Ví dụ:\n/timkiem thay nhớt xe lần gần nhất\n/timkiem họp chuyên môn tháng 3',
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  await handleNaturalSearch(bot, chatId, query, null);
}

/**
 * /hoantac - Undo thao tác gần nhất
 */
async function handleHoanTac(bot, msg) {
  const chatId = msg.chat.id;

  try {
    const lastAction = await getLastAction();

    if (!lastAction) {
      await bot.sendMessage(chatId, '↩️ Không có thao tác nào để hoàn tác\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    if (lastAction.type === 'save_entries') {
      // Xóa các entries vừa lưu
      for (const item of lastAction.items || []) {
        if (item.id) await firebase.deleteEntry(item.id);
      }
      await saveLastAction(null);
      await bot.sendMessage(chatId, `↩️ Đã hoàn tác\\. Xóa ${lastAction.items?.length || 0} mục vừa lưu\\.`, { parse_mode: 'MarkdownV2' });

    } else if (lastAction.type === 'save_attendance') {
      // Không xóa điểm danh tự động - thông báo
      await bot.sendMessage(chatId, '⚠️ Điểm danh không thể hoàn tác tự động\\. Bạn tự xóa record trong /baocao nhé\\.', { parse_mode: 'MarkdownV2' });

    } else if (lastAction.type === 'delete_entry') {
      await bot.sendMessage(chatId, '⚠️ Không thể khôi phục entry đã xóa\\.', { parse_mode: 'MarkdownV2' });

    } else {
      await bot.sendMessage(chatId, `↩️ Không thể hoàn tác thao tác: *${escMD(lastAction.type)}*\\.`, { parse_mode: 'MarkdownV2' });
    }
  } catch (err) {
    console.error('handleHoanTac error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi hoàn tác\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * /huongdan - Hướng dẫn sử dụng
 */
async function handleHuongDan(bot, msg) {
  const chatId = msg.chat.id;

  const text = `📖 *HƯỚNG DẪN SỬ DỤNG*
━━━━━━━━━━━━━━

*🗣️ Chat tự nhiên:*
• "hôm nay dạy lớp 4A, bài PowerPoint"
• "chi 50k cafe sáng"
• "họp chuyên môn thứ 6 tuần này"
• "nhớ soạn giáo án trước thứ 4"
• "hôm nay mệt quá, học sinh ồn ào"

*✅ Điểm danh:*
• "tin 3\\-5 vắng An, Bình"
• "tin 3\\-5 đủ hết"
• "lớp 4 thứ 6 vắng Nam có phép"

*💰 Học phí:*
• "thu hp tháng 3: An 450k ck vợ"
• "tháng 3 lớp tin 3\\-5 còn ai chưa đóng?"

*📚 Setup lớp:*
• "setup nhóm tin 3\\-5, lịch thứ 3 \\+ thứ 6\\.\\.\\."`

  const text2 = `*🔍 Tìm kiếm:*
• "thay nhớt xe lần gần nhất ngày mấy?"
• "tháng 3 tôi chi gì?"
• "em nào vắng nhiều nhất?"

*📖 Nhật ký:*
• "nhật ký tháng 3"
• "tháng 3 làm được gì?"

*⌨️ Lệnh nhanh:*
/homnay \\- lịch hôm nay
/tuannay \\- lịch cả tuần
/conlai \\- việc chưa xong
/baocao \\- báo cáo
/danhsach \\- danh sách lớp
/hoantac \\- undo vừa làm
/hocphi \\- tổng quan học phí

*✏️ Sửa\\/xóa:*
Sau khi list, gõ "sửa 2" hoặc "xóa 3"`;

  await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  await bot.sendMessage(chatId, text2, { parse_mode: 'MarkdownV2' });
}

/**
 * /danhsach - Danh sách lớp học
 */
async function handleDanhSach(bot, msg) {
  await handleListClasses(bot, msg.chat.id);
}

/**
 * /hocphi [tháng] - Tổng quan học phí
 */
async function handleHocPhi(bot, msg, args) {
  const chatId = msg.chat.id;
  const month = parseMonthArg(args) || currentMonth();
  await showTuitionOverview(bot, chatId, month);
}

// ==================== HELPER ====================

/**
 * Parse args của lệnh báo cáo
 * Ví dụ: "chitieu thang3" → { type: 'chitieu', month: '2026-03' }
 */
function parseReportArgs(args) {
  if (!args) return { type: 'tonghop', month: currentMonth() };

  const reportTypes = ['chitieu', 'hocphi', 'diemdanh', 'giangday', 'congviec', 'tonghop', 'thongke'];
  const parts = args.toLowerCase().split(/\s+/);

  let type = 'tonghop';
  let month = currentMonth();

  for (const part of parts) {
    if (reportTypes.includes(part)) {
      type = part;
    }
    const monthParsed = parseMonthArg(part);
    if (monthParsed) month = monthParsed;
  }

  return { type, month };
}

/**
 * Parse tháng từ string (thang3, tháng 3, 2026-03...)
 */
function parseMonthArg(arg) {
  if (!arg) return null;

  const year = new Date().getFullYear();

  // "thang3" hoặc "tháng3" hoặc "tháng 3"
  const match1 = arg.match(/th[aá]ng\s*(\d{1,2})/i);
  if (match1) {
    return `${year}-${String(match1[1]).padStart(2, '0')}`;
  }

  // "2026-03"
  const match2 = arg.match(/(\d{4})-(\d{2})/);
  if (match2) return arg;

  // "03" hoặc "3"
  const match3 = arg.match(/^(\d{1,2})$/);
  if (match3) {
    return `${year}-${String(match3[1]).padStart(2, '0')}`;
  }

  return null;
}

module.exports = {
  registerCommands,
  handleStart,
  handleHomNay,
  handleTuanNay,
  handleConLai,
  handleBaoCao,
  handleThongKe,
  handleTimKiem,
  handleHoanTac,
  handleHuongDan,
  handleDanhSach,
  handleHocPhi,
};
