const firebase = require('../services/firebase');
const { formatEntry, escMD } = require('../utils/formatter');
const {
  setEditing,
  setEditingField,
  setConfirmingDelete,
  resetToChat,
  saveLastAction,
  getLastListItem,
} = require('../utils/stateManager');

// Danh sách field có thể sửa theo loại entry
const EDITABLE_FIELDS = {
  default: ['title', 'content', 'date', 'status'],
  expense: ['title', 'content', 'date', 'amount', 'category'],
  income: ['title', 'content', 'date', 'amount'],
  teaching: ['title', 'content', 'date', 'lesson'],
  schedule: ['title', 'content', 'date', 'time'],
  task: ['title', 'content', 'deadline', 'priority', 'status'],
  personal: ['title', 'content', 'date'],
  activity: ['title', 'content', 'date'],
};

const FIELD_LABELS = {
  title: 'Tiêu đề',
  content: 'Nội dung',
  date: 'Ngày (YYYY-MM-DD)',
  amount: 'Số tiền',
  category: 'Danh mục',
  lesson: 'Bài học',
  time: 'Giờ (HH:MM)',
  deadline: 'Hạn chót (YYYY-MM-DD)',
  priority: 'Độ ưu tiên (high/medium/low)',
  status: 'Trạng thái (done/pending/cancelled)',
};

/**
 * Xử lý lệnh "sửa [số]" - bắt đầu flow sửa entry
 */
async function handleEditRequest(bot, msg, index, session) {
  const chatId = msg.chat.id;

  const item = await getLastListItem(index);
  if (!item || !item.id) {
    await bot.sendMessage(
      chatId,
      `❌ Không tìm thấy mục số *${index}*\\. Bạn list lại rồi sửa nhé\\!`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  try {
    const entry = await firebase.getEntryById(item.id);
    if (!entry) {
      await bot.sendMessage(chatId, '❌ Không tìm thấy entry này\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    // Hiển thị menu chọn field
    const fields = EDITABLE_FIELDS[entry.type] || EDITABLE_FIELDS.default;
    let menuText = `✏️ *Sửa:* ${escMD(entry.title || entry.content)}\n\n`;
    menuText += `Chọn trường muốn sửa:\n`;
    fields.forEach((f, i) => {
      const currentVal = entry[f];
      menuText += `${i + 1}\\. *${escMD(FIELD_LABELS[f] || f)}*`;
      if (currentVal) menuText += ` \\(hiện tại: ${escMD(String(currentVal))}\\)`;
      menuText += '\n';
    });
    menuText += '\nGõ số để chọn trường cần sửa\\.';

    await setEditing(item.id, { ...entry, _fields: fields });
    await bot.sendMessage(chatId, menuText, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('handleEditRequest error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi mở form sửa\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Xử lý chọn field để sửa (user gõ số)
 */
async function handleEditSelect(bot, msg, session) {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || '';
  const { editing_entry_id, pending_data } = session;

  const entry = pending_data?.entry;
  const fields = entry?._fields || EDITABLE_FIELDS.default;

  const index = parseInt(text);
  if (isNaN(index) || index < 1 || index > fields.length) {
    await bot.sendMessage(
      chatId,
      `Bạn gõ số từ *1* đến *${fields.length}* nhé\\!`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const selectedField = fields[index - 1];
  const fieldLabel = FIELD_LABELS[selectedField] || selectedField;
  const currentVal = entry?.[selectedField];

  await setEditingField(editing_entry_id, selectedField, entry);
  await bot.sendMessage(
    chatId,
    `✏️ Nhập *${escMD(fieldLabel)}* mới:\n${currentVal ? `\\(hiện tại: ${escMD(String(currentVal))}\\)` : ''}`,
    { parse_mode: 'MarkdownV2' }
  );
}

/**
 * Xử lý nhập giá trị mới cho field
 */
async function handleNewValue(bot, msg, session) {
  const chatId = msg.chat.id;
  const newValue = msg.text?.trim() || '';
  const { editing_entry_id, pending_data } = session;

  const { field, entry } = pending_data || {};

  if (!field || !editing_entry_id) {
    await resetToChat();
    await bot.sendMessage(chatId, 'Có lỗi xảy ra\\. Bạn thử lại nhé\\!', { parse_mode: 'MarkdownV2' });
    return;
  }

  try {
    // Validate và convert giá trị
    const convertedValue = convertFieldValue(field, newValue);

    const oldValue = entry?.[field];
    const updates = { [field]: convertedValue };

    // Nếu sửa ngày → cập nhật month và week
    if (field === 'date') {
      updates.month = convertedValue.substring(0, 7);
      const { dateToWeek } = require('../utils/dateHelper');
      updates.week = dateToWeek(convertedValue);
    }

    await firebase.updateEntry(editing_entry_id, updates, entry);
    await saveLastAction({
      type: 'edit_entry',
      entry_id: editing_entry_id,
      field,
      old_value: oldValue,
      new_value: convertedValue,
    });

    await resetToChat();
    await bot.sendMessage(
      chatId,
      `✅ Đã cập nhật *${escMD(FIELD_LABELS[field] || field)}*\\!\n${escMD(String(oldValue || ''))} → *${escMD(String(convertedValue))}*`,
      { parse_mode: 'MarkdownV2' }
    );
  } catch (err) {
    console.error('handleNewValue error:', err);
    await bot.sendMessage(chatId, `❌ Giá trị không hợp lệ\\. ${escMD(err.message)}`, { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Xử lý lệnh "xóa [số]"
 */
async function handleDeleteRequest(bot, msg, index, session) {
  const chatId = msg.chat.id;

  const item = await getLastListItem(index);
  if (!item || !item.id) {
    await bot.sendMessage(
      chatId,
      `❌ Không tìm thấy mục số *${index}*\\. Bạn list lại rồi xóa nhé\\!`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  try {
    const entry = await firebase.getEntryById(item.id);
    const displayText = entry?.title || entry?.content || item.display || 'entry này';

    await setConfirmingDelete(item.id, entry);
    await bot.sendMessage(
      chatId,
      `🗑️ Xóa *${escMD(displayText)}* không\\?\n\\(ok/không\\)`,
      { parse_mode: 'MarkdownV2' }
    );
  } catch (err) {
    console.error('handleDeleteRequest error:', err);
    await bot.sendMessage(chatId, 'Có lỗi khi xóa\\.', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Validate và convert giá trị field
 */
function convertFieldValue(field, value) {
  switch (field) {
    case 'amount':
      // Chuyển "450k" → 450000, "1.2tr" → 1200000
      return parseAmount(value);

    case 'date':
    case 'deadline':
      // Validate format YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error('Ngày phải có định dạng YYYY-MM-DD (ví dụ: 2026-04-09)');
      }
      return value;

    case 'priority':
      if (!['high', 'medium', 'low'].includes(value.toLowerCase())) {
        throw new Error('Độ ưu tiên phải là: high, medium, hoặc low');
      }
      return value.toLowerCase();

    case 'status':
      if (!['done', 'pending', 'cancelled', 'carried_over'].includes(value.toLowerCase())) {
        throw new Error('Trạng thái phải là: done, pending, cancelled, hoặc carried_over');
      }
      return value.toLowerCase();

    default:
      return value;
  }
}

/**
 * Parse số tiền từ string (450k, 1.2tr, 450000)
 */
function parseAmount(value) {
  const str = value.toLowerCase().replace(/[.,\s]/g, '');
  if (str.endsWith('tr')) {
    return parseFloat(str.slice(0, -2)) * 1000000;
  }
  if (str.endsWith('k')) {
    return parseFloat(str.slice(0, -1)) * 1000;
  }
  const num = parseFloat(str);
  if (isNaN(num)) throw new Error('Số tiền không hợp lệ');
  return num;
}

module.exports = {
  handleEditRequest,
  handleEditSelect,
  handleNewValue,
  handleDeleteRequest,
};
