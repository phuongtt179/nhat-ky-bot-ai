const firebase = require('../services/firebase');

// Các trạng thái hội thoại
const STATES = {
  CHATTING: 'chatting',                     // Trạng thái bình thường
  CONFIRMING_SAVE: 'confirming',            // Đang chờ xác nhận lưu
  CONFIRMING_DELETE: 'confirming_delete',   // Đang chờ xác nhận xóa
  EDITING: 'editing',                       // Đang chọn field để sửa
  EDITING_FIELD: 'editing_field',           // Đang nhập giá trị mới
  SETUP_CLASS: 'setup_class',               // Đang setup lớp học
  WEEKLY_REVIEW: 'weekly_review',           // Đang xem weekly review
  ATTENDANCE_CLARIFY: 'attendance_clarify', // Hỏi buổi học hoặc tên trùng
  TUITION_CLARIFY: 'tuition_clarify',       // Hỏi xác nhận hp trùng
};

/**
 * Lấy session hiện tại
 */
async function getSession() {
  return await firebase.getSession();
}

/**
 * Chuyển sang trạng thái chờ xác nhận lưu
 */
async function setConfirmingSave(pendingData) {
  await firebase.updateSession({
    state: STATES.CONFIRMING_SAVE,
    pending_data: pendingData,
  });
}

/**
 * Chuyển sang trạng thái chờ xác nhận xóa
 */
async function setConfirmingDelete(entryId, entryInfo) {
  await firebase.updateSession({
    state: STATES.CONFIRMING_DELETE,
    editing_entry_id: entryId,
    pending_data: { entry_info: entryInfo },
  });
}

/**
 * Chuyển sang trạng thái đang sửa (chọn field)
 */
async function setEditing(entryId, entryData) {
  await firebase.updateSession({
    state: STATES.EDITING,
    editing_entry_id: entryId,
    pending_data: { entry: entryData },
  });
}

/**
 * Chuyển sang trạng thái đang nhập giá trị mới
 */
async function setEditingField(entryId, field, entryData) {
  await firebase.updateSession({
    state: STATES.EDITING_FIELD,
    editing_entry_id: entryId,
    pending_data: { field, entry: entryData },
  });
}

/**
 * Chuyển sang trạng thái hỏi buổi điểm danh
 */
async function setAttendanceClarify(pendingData) {
  await firebase.updateSession({
    state: STATES.ATTENDANCE_CLARIFY,
    pending_data: pendingData,
  });
}

/**
 * Chuyển sang trạng thái xác nhận học phí trùng
 */
async function setTuitionClarify(pendingData) {
  await firebase.updateSession({
    state: STATES.TUITION_CLARIFY,
    pending_data: pendingData,
  });
}

/**
 * Chuyển sang weekly review
 */
async function setWeeklyReview(reviewData) {
  await firebase.updateSession({
    state: STATES.WEEKLY_REVIEW,
    pending_data: reviewData,
  });
}

/**
 * Reset về trạng thái chatting bình thường
 */
async function resetToChat() {
  await firebase.updateSession({
    state: STATES.CHATTING,
    editing_entry_id: null,
    pending_data: null,
  });
}

/**
 * Lưu last_list (kết quả list gần nhất để sửa/xóa)
 */
async function saveLastList(items) {
  await firebase.updateSession({ last_list: items });
}

/**
 * Lấy item từ last_list theo số thứ tự (1-indexed)
 */
async function getLastListItem(index) {
  const session = await getSession();
  const list = session.last_list || [];
  return list[index - 1] || null;
}

/**
 * Lưu last_action để hỗ trợ /hoantac
 */
async function saveLastAction(action) {
  await firebase.updateSession({ last_action: action });
}

/**
 * Lấy last_action
 */
async function getLastAction() {
  const session = await getSession();
  return session.last_action || null;
}

/**
 * Kiểm tra tin nhắn có phải xác nhận "có" không
 */
function isConfirmYes(text) {
  const yesPatterns = /^(ok|okay|có|co|yes|y|ừ|uh|được|dc|lưu|lu|đồng ý|dong y|✓|👍)$/i;
  return yesPatterns.test(text.trim());
}

/**
 * Kiểm tra tin nhắn có phải từ chối "không" không
 */
function isConfirmNo(text) {
  const noPatterns = /^(không|khong|no|n|thôi|thoi|bỏ|bo|hủy|huy|cancel|❌|👎)$/i;
  return noPatterns.test(text.trim());
}

/**
 * Kiểm tra tin nhắn có phải lệnh sửa không (sửa 1, sửa 2...)
 */
function isEditCommand(text) {
  return /^sửa\s+\d+$/i.test(text.trim()) || /^sua\s+\d+$/i.test(text.trim());
}

/**
 * Kiểm tra tin nhắn có phải lệnh xóa không (xóa 1, xóa 2...)
 */
function isDeleteCommand(text) {
  return /^xóa\s+\d+$/i.test(text.trim()) || /^xoa\s+\d+$/i.test(text.trim());
}

/**
 * Lấy số từ lệnh sửa/xóa
 */
function getCommandIndex(text) {
  const match = text.trim().match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

module.exports = {
  STATES,
  getSession,
  setConfirmingSave,
  setConfirmingDelete,
  setEditing,
  setEditingField,
  setAttendanceClarify,
  setTuitionClarify,
  setWeeklyReview,
  resetToChat,
  saveLastList,
  getLastListItem,
  saveLastAction,
  getLastAction,
  isConfirmYes,
  isConfirmNo,
  isEditCommand,
  isDeleteCommand,
  getCommandIndex,
};
