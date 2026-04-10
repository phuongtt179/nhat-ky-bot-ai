const admin = require('firebase-admin');
const dayjs = require('dayjs');

// Khởi tạo Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

const db = admin.firestore();
const USER_ID = process.env.OWNER_TELEGRAM_ID;

// Helper: lấy reference collection của user
const userRef = () => db.collection('users').doc(String(USER_ID));

// ==================== ENTRIES ====================

/**
 * Lưu một entry mới vào Firestore
 */
async function saveEntry(entry) {
  const now = dayjs();
  const data = {
    ...entry,
    date: entry.date || now.format('YYYY-MM-DD'),
    month: entry.month || now.format('YYYY-MM'),
    week: entry.week || `${now.format('YYYY')}-W${String(now.week()).padStart(2, '0')}`,
    status: entry.status || 'done',
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    edit_history: [],
  };
  const ref = await userRef().collection('entries').add(data);
  return { id: ref.id, ...data };
}

/**
 * Lấy entries theo tháng
 */
async function getEntriesByMonth(month) {
  const snap = await userRef()
    .collection('entries')
    .where('month', '==', month)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy entries theo ngày
 */
async function getEntriesByDate(date) {
  const snap = await userRef()
    .collection('entries')
    .where('date', '==', date)
    .orderBy('created_at', 'asc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy entries theo tuần
 */
async function getEntriesByWeek(week) {
  const snap = await userRef()
    .collection('entries')
    .where('week', '==', week)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy entries theo type và tháng
 */
async function getEntriesByTypeAndMonth(type, month) {
  const snap = await userRef()
    .collection('entries')
    .where('type', '==', type)
    .where('month', '==', month)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy tasks chưa xong (pending/carried_over)
 */
async function getPendingTasks() {
  const snap = await userRef()
    .collection('entries')
    .where('type', '==', 'task')
    .where('status', 'in', ['pending', 'carried_over'])
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy lịch/sự kiện tương lai
 */
async function getUpcomingSchedules(fromDate) {
  const snap = await userRef()
    .collection('entries')
    .where('type', '==', 'schedule')
    .where('date', '>=', fromDate)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Cập nhật entry
 */
async function updateEntry(entryId, updates, oldData) {
  const editRecord = {
    edited_at: new Date().toISOString(),
    fields: updates,
  };
  await userRef()
    .collection('entries')
    .doc(entryId)
    .update({
      ...updates,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      edit_history: admin.firestore.FieldValue.arrayUnion(editRecord),
    });
}

/**
 * Xóa entry
 */
async function deleteEntry(entryId) {
  await userRef().collection('entries').doc(entryId).delete();
}

/**
 * Lấy entry theo ID
 */
async function getEntryById(entryId) {
  const doc = await userRef().collection('entries').doc(entryId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Query entries theo nhiều điều kiện (dùng cho tìm kiếm)
 */
async function queryEntries({ month, type, dateFrom, dateTo, status } = {}) {
  let query = userRef().collection('entries');
  if (month) query = query.where('month', '==', month);
  if (type) query = query.where('type', '==', type);
  if (dateFrom) query = query.where('date', '>=', dateFrom);
  if (dateTo) query = query.where('date', '<=', dateTo);
  if (status) query = query.where('status', '==', status);
  const snap = await query.orderBy('date', 'asc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy entries có reminder cho ngày mai
 */
async function getEntriesWithReminder(date) {
  const snap = await userRef()
    .collection('entries')
    .where('date', '==', date)
    .get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return all.filter(e =>
    e.reminder && e.reminder.some(r => !r.sent)
  );
}

// ==================== CLASSES ====================

/**
 * Lưu/cập nhật thông tin lớp học
 */
async function saveClass(classId, classData) {
  await userRef().collection('classes').doc(classId).set(classData, { merge: true });
}

/**
 * Lấy thông tin một lớp
 */
async function getClass(classId) {
  const doc = await userRef().collection('classes').doc(classId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Lấy tất cả lớp học
 */
async function getAllClasses() {
  const snap = await userRef().collection('classes').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Xóa lớp học
 */
async function deleteClass(classId) {
  await userRef().collection('classes').doc(classId).delete();
}

// ==================== ATTENDANCE ====================

/**
 * Lưu bản ghi điểm danh
 */
async function saveAttendance(data) {
  const record = {
    ...data,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  };
  const ref = await userRef().collection('attendance').add(record);
  return { id: ref.id, ...record };
}

/**
 * Lấy điểm danh theo lớp và tháng
 */
async function getAttendanceByClassAndMonth(classId, month) {
  const snap = await userRef()
    .collection('attendance')
    .where('class_id', '==', classId)
    .where('month', '==', month)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy điểm danh theo ngày và lớp
 */
async function getAttendanceByDateAndClass(date, classId) {
  const snap = await userRef()
    .collection('attendance')
    .where('date', '==', date)
    .where('class_id', '==', classId)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy tất cả điểm danh theo tháng
 */
async function getAttendanceByMonth(month) {
  const snap = await userRef()
    .collection('attendance')
    .where('month', '==', month)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Cập nhật bản ghi điểm danh
 */
async function updateAttendance(recordId, updates) {
  await userRef().collection('attendance').doc(recordId).update(updates);
}

// ==================== TUITION ====================

/**
 * Lưu bản ghi học phí
 */
async function saveTuition(data) {
  const record = {
    ...data,
    paid_at: admin.firestore.FieldValue.serverTimestamp(),
  };
  const ref = await userRef().collection('tuition').add(record);
  return { id: ref.id, ...record };
}

/**
 * Lấy học phí theo lớp và tháng
 */
async function getTuitionByClassAndMonth(classId, month) {
  const snap = await userRef()
    .collection('tuition')
    .where('class_id', '==', classId)
    .where('month', '==', month)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy học phí theo tháng (tất cả lớp)
 */
async function getTuitionByMonth(month) {
  const snap = await userRef()
    .collection('tuition')
    .where('month', '==', month)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Lấy học phí theo tên học sinh
 */
async function getTuitionByStudent(studentName) {
  const snap = await userRef()
    .collection('tuition')
    .where('student_name', '==', studentName)
    .orderBy('month', 'desc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ==================== SESSION ====================

/**
 * Lấy session hiện tại của user
 */
async function getSession() {
  const doc = await userRef().collection('sessions').doc('current').get();
  if (!doc.exists) {
    return {
      state: 'chatting',
      messages: [],
      last_list: [],
      last_action: null,
      editing_entry_id: null,
      pending_data: null,
    };
  }
  return doc.data();
}

/**
 * Cập nhật session
 */
async function updateSession(updates) {
  await userRef().collection('sessions').doc('current').set(updates, { merge: true });
}

/**
 * Reset session về trạng thái ban đầu
 */
async function resetSession() {
  await userRef().collection('sessions').doc('current').set({
    state: 'chatting',
    messages: [],
    last_list: [],
    last_action: null,
    editing_entry_id: null,
    pending_data: null,
  });
}

/**
 * Thêm tin nhắn vào lịch sử hội thoại (tối đa 20 tin)
 */
async function addMessageToHistory(role, content) {
  const session = await getSession();
  const messages = session.messages || [];
  messages.push({ role, content, time: new Date().toISOString() });
  // Giữ tối đa 20 tin nhắn gần nhất
  const trimmed = messages.slice(-20);
  await updateSession({ messages: trimmed });
}

// ==================== PROFILE ====================

/**
 * Lấy profile user
 */
async function getProfile() {
  const doc = await userRef().collection('profile').doc('info').get();
  if (!doc.exists) return null;
  return doc.data();
}

/**
 * Lưu/cập nhật profile
 */
async function saveProfile(data) {
  await userRef().collection('profile').doc('info').set(data, { merge: true });
}

module.exports = {
  // Entries
  saveEntry,
  getEntriesByMonth,
  getEntriesByDate,
  getEntriesByWeek,
  getEntriesByTypeAndMonth,
  getPendingTasks,
  getUpcomingSchedules,
  updateEntry,
  deleteEntry,
  getEntryById,
  queryEntries,
  getEntriesWithReminder,
  // Classes
  saveClass,
  getClass,
  getAllClasses,
  deleteClass,
  // Attendance
  saveAttendance,
  getAttendanceByClassAndMonth,
  getAttendanceByDateAndClass,
  getAttendanceByMonth,
  updateAttendance,
  // Tuition
  saveTuition,
  getTuitionByClassAndMonth,
  getTuitionByMonth,
  getTuitionByStudent,
  // Session
  getSession,
  updateSession,
  resetSession,
  addMessageToHistory,
  // Profile
  getProfile,
  saveProfile,
};
