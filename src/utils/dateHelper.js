const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
const weekOfYear = require('dayjs/plugin/weekOfYear');

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

// Mapping thứ tiếng Việt → số (0=CN, 1=T2...6=T7)
const DAY_MAP = {
  'chu_nhat': 0, 'cn': 0, 'chủ nhật': 0,
  'thu_2': 1, 't2': 1, 'thứ 2': 1, 'thứ hai': 1,
  'thu_3': 2, 't3': 2, 'thứ 3': 2, 'thứ ba': 2,
  'thu_4': 3, 't4': 3, 'thứ 4': 3, 'thứ tư': 3,
  'thu_5': 4, 't5': 4, 'thứ 5': 4, 'thứ năm': 4,
  'thu_6': 5, 't6': 5, 'thứ 6': 5, 'thứ sáu': 5,
  'thu_7': 6, 't7': 6, 'thứ 7': 6, 'thứ bảy': 6,
};

// Mapping số → tên thứ tiếng Việt đầy đủ
const DAY_NAMES_VN = {
  0: 'Chủ nhật',
  1: 'Thứ hai',
  2: 'Thứ ba',
  3: 'Thứ tư',
  4: 'Thứ năm',
  5: 'Thứ sáu',
  6: 'Thứ bảy',
};

// Mapping số → key session
const DAY_TO_SESSION = {
  0: 'chu_nhat',
  1: 'thu_2',
  2: 'thu_3',
  3: 'thu_4',
  4: 'thu_5',
  5: 'thu_6',
  6: 'thu_7',
};

/**
 * Lấy ngày hôm nay dạng YYYY-MM-DD
 */
function today() {
  return dayjs().format('YYYY-MM-DD');
}

/**
 * Lấy tháng hiện tại dạng YYYY-MM
 */
function currentMonth() {
  return dayjs().format('YYYY-MM');
}

/**
 * Lấy tuần hiện tại dạng YYYY-WNN
 */
function currentWeek() {
  const d = dayjs();
  return `${d.format('YYYY')}-W${String(d.isoWeek()).padStart(2, '0')}`;
}

/**
 * Lấy tên thứ tiếng Việt của ngày hôm nay
 */
function todayDayName() {
  return DAY_NAMES_VN[dayjs().day()];
}

/**
 * Lấy session key của hôm nay (thu_3, thu_6, ...)
 */
function todaySession() {
  return DAY_TO_SESSION[dayjs().day()];
}

/**
 * Chuyển session key → tên thứ tiếng Việt
 * Ví dụ: "thu_3" → "Thứ ba"
 */
function sessionToDisplayName(session) {
  const num = DAY_MAP[session];
  return num !== undefined ? DAY_NAMES_VN[num] : session;
}

/**
 * Chuyển ngày → tên thứ tiếng Việt
 */
function dateToWeekday(dateStr) {
  return DAY_NAMES_VN[dayjs(dateStr).day()];
}

/**
 * Tính week string từ ngày
 */
function dateToWeek(dateStr) {
  const d = dayjs(dateStr);
  return `${d.format('YYYY')}-W${String(d.isoWeek()).padStart(2, '0')}`;
}

/**
 * Lấy ngày đầu tuần (Thứ hai) và cuối tuần (Chủ nhật) của ngày hiện tại
 */
function getWeekRange(dateStr) {
  const d = dayjs(dateStr || today());
  const start = d.startOf('isoWeek'); // Thứ hai
  const end = d.endOf('isoWeek');     // Chủ nhật
  return {
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD'),
    label: `${start.format('DD/MM')} - ${end.format('DD/MM/YYYY')}`,
  };
}

/**
 * Lấy các ngày trong tuần theo session classes
 * Ví dụ: sessions = ["thu_3", "thu_6"] → các ngày thứ 3, thứ 6 trong tuần hiện tại
 */
function getSessionDatesThisWeek(sessions) {
  const weekStart = dayjs().startOf('isoWeek'); // Thứ hai
  return sessions.map(session => {
    const dayNum = DAY_MAP[session];
    if (dayNum === undefined) return null;
    // dayjs: 0=CN, 1=T2...6=T7; isoWeek bắt đầu từ T2
    const offset = dayNum === 0 ? 6 : dayNum - 1;
    return {
      session,
      date: weekStart.add(offset, 'day').format('YYYY-MM-DD'),
      dayName: DAY_NAMES_VN[dayNum],
    };
  }).filter(Boolean);
}

/**
 * Kiểm tra hôm nay có buổi học không (dựa vào sessions của lớp)
 */
function hasTodaySession(sessions) {
  const todaySess = todaySession();
  return sessions.includes(todaySess);
}

/**
 * Lấy buổi học hôm nay của một lớp
 */
function getTodaySession(sessions) {
  const todaySess = todaySession();
  return sessions.includes(todaySess) ? todaySess : null;
}

/**
 * Format ngày hiển thị tiếng Việt
 * Ví dụ: "2026-04-09" → "Thứ năm, 09/04/2026"
 */
function formatDateVN(dateStr) {
  const d = dayjs(dateStr);
  const dayName = DAY_NAMES_VN[d.day()];
  return `${dayName}, ${d.format('DD/MM/YYYY')}`;
}

/**
 * Format tháng tiếng Việt
 * Ví dụ: "2026-04" → "Tháng 4/2026"
 */
function formatMonthVN(monthStr) {
  const [year, month] = monthStr.split('-');
  return `Tháng ${parseInt(month)}/${year}`;
}

/**
 * Tính số tiền định dạng tiếng Việt
 * Ví dụ: 450000 → "450.000đ"
 */
function formatMoney(amount) {
  if (!amount && amount !== 0) return 'N/A';
  return amount.toLocaleString('vi-VN') + 'đ';
}

/**
 * Lấy tháng trước
 */
function previousMonth(monthStr) {
  return dayjs(monthStr + '-01').subtract(1, 'month').format('YYYY-MM');
}

/**
 * Lấy tháng tiếp theo
 */
function nextMonth(monthStr) {
  return dayjs(monthStr + '-01').add(1, 'month').format('YYYY-MM');
}

/**
 * Ngày mai
 */
function tomorrow() {
  return dayjs().add(1, 'day').format('YYYY-MM-DD');
}

/**
 * Hôm qua
 */
function yesterday() {
  return dayjs().subtract(1, 'day').format('YYYY-MM-DD');
}

/**
 * Lấy danh sách ngày trong tháng mà có sessions
 * Dùng để check lớp nào có lịch hôm nay
 */
function getSessionDatesInMonth(sessions, monthStr) {
  const start = dayjs(monthStr + '-01');
  const end = start.endOf('month');
  const dates = [];
  let current = start;

  while (current.isBefore(end) || current.isSame(end, 'day')) {
    const sessionKey = DAY_TO_SESSION[current.day()];
    if (sessions.includes(sessionKey)) {
      dates.push(current.format('YYYY-MM-DD'));
    }
    current = current.add(1, 'day');
  }
  return dates;
}

module.exports = {
  today,
  tomorrow,
  yesterday,
  currentMonth,
  currentWeek,
  todayDayName,
  todaySession,
  sessionToDisplayName,
  dateToWeekday,
  dateToWeek,
  getWeekRange,
  getSessionDatesThisWeek,
  hasTodaySession,
  getTodaySession,
  formatDateVN,
  formatMonthVN,
  formatMoney,
  previousMonth,
  nextMonth,
  getSessionDatesInMonth,
  DAY_MAP,
  DAY_NAMES_VN,
  DAY_TO_SESSION,
};
