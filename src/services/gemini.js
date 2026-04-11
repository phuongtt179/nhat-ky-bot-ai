const { GoogleGenerativeAI } = require('@google/generative-ai');
const dayjs = require('dayjs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

// ==================== SYSTEM PROMPT ====================

/**
 * Tạo system prompt chính cho Gemini - ngữ cảnh giáo viên tiểu học VN
 */
function buildSystemPrompt(userClasses = []) {
  const currentDate = dayjs().format('YYYY-MM-DD');
  const dayOfWeek = getDayOfWeekVN(dayjs().day());

  const classInfo = userClasses.length > 0
    ? userClasses.map(c =>
        `- ${c.display_name} (${c.subject}): lịch ${c.sessions?.join(', ')} | ${c.students?.length || 0} học sinh`
      ).join('\n')
    : '(chưa có lớp nào được setup)';

  return `Bạn là trợ lý cá nhân thông minh của một giáo viên Tin học tiểu học tại Việt Nam.
Ngày hiện tại: ${currentDate} (${dayOfWeek})

DANH SÁCH LỚP HỌC HIỆN TẠI:
${classInfo}

NGUYÊN TẮC GIAO TIẾP:
- Luôn dùng tiếng Việt, thân thiện như đồng nghiệp
- Ngắn gọn, súc tích, dùng emoji phù hợp
- Xưng "mình", gọi user là "bạn"
- Khi không chắc → hỏi lại, không tự đoán sai

PHÂN LOẠI TIN NHẮN:
- expense: có số tiền + mua/chi/trả/mất/tốn
- income: lương/thu/nhận/được trả/thưởng
- teaching: dạy/lớp/tiết/HS/giáo án/soạn bài/tổ chức thi/chấm bài/họp chuyên môn
- schedule: lịch/họp/thi/sự kiện tương lai + ngày cụ thể
- task: việc cần làm/nhớ làm/chưa xong
- activity: hoạt động đã xảy ra hôm nay hoặc quá khứ (không phải chi tiêu, không có ngày cụ thể tương lai)
- personal: cảm xúc/suy nghĩ/nhật ký/tâm sự/chia sẻ cá nhân
- attendance: điểm danh/vắng/có mặt/nghỉ
- tuition: thu hp/học phí/đóng tiền
- setup: setup lớp/thêm lớp/tạo lớp/thêm học sinh/xóa học sinh/cập nhật lớp
- question: CHỈ dùng khi tin nhắn là câu HỎI rõ ràng về dữ liệu đã lưu (có dấu "?", hoặc dùng từ "bao nhiêu/mấy/khi nào/hôm nào/tìm/xem/kiểm tra")
- unknown: KHÔNG DÙNG nếu tin nhắn có thể là ghi chép hoạt động

NGUYÊN TẮC QUAN TRỌNG:
- Nếu user MÔ TẢ việc đã làm/đang làm → đây là GHI CHÉP (teaching/activity/personal...), KHÔNG phải question
- Nếu user HỎI về dữ liệu cũ → mới là question
- Ví dụ GHI CHÉP: "hôm nay dạy lớp 4A", "tổ chức thi VIOEDU", "họp chuyên môn sáng nay", "mệt quá"
- Ví dụ CÂU HỎI: "hôm nay dạy lớp nào?", "tháng 3 chi bao nhiêu?", "An vắng mấy buổi?"

NHẬN DẠNG ĐIỂM DANH:
- Pattern: "[tên nhóm/lớp] vắng [tên1], [tên2]"
- Pattern: "[tên nhóm/lớp] đủ hết"
- Pattern: "[tên nhóm/lớp] [buổi] vắng [tên]"
- Trả về: { type: "attendance", class_name, session_hint, absent_names[], present_all, reason }

NHẬN DẠNG THU HỌC PHÍ:
- Pattern: "thu hp tháng [N] [tên] [lớp] [số tiền] [hình thức]"
- Hình thức: "ck vợ"→"ck_vo", "ck chồng"→"ck_chong", "tiền mặt"→"tien_mat"
- Trả về: { type: "tuition", month, items: [{name, class, amount, method}] }

XỬ LÝ NGÀY THÁNG:
- "hôm nay" = ${currentDate}
- "ngày mai" = ${dayjs().add(1, 'day').format('YYYY-MM-DD')}
- "hôm qua" = ${dayjs().subtract(1, 'day').format('YYYY-MM-DD')}
- "tuần sau thứ 4" = tính chính xác ngày
- "tháng 3" = ${dayjs().format('YYYY')}-03
- Luôn trả về YYYY-MM-DD

KHI TÌM KIẾM:
- Đọc kỹ toàn bộ dữ liệu được cung cấp
- Tìm theo ngữ nghĩa, không chỉ từ khóa
- Trả lời kèm ngày cụ thể và tóm tắt
- Nếu không tìm thấy → gợi ý tìm cách khác

KHI TỔNG HỢP NHẬT KÝ:
- Tổng hợp thành văn bản tự nhiên, không chỉ liệt kê
- Highlight điểm nổi bật, thành tích, khó khăn
- Thêm nhận xét, cảm nhận phù hợp
- Phân nhóm theo chủ đề: dạy học, cá nhân, tài chính, công việc

LUÔN TRẢ VỀ JSON HỢP LỆ, KHÔNG THÊM TEXT NGOÀI JSON.`;
}

/**
 * Lấy tên ngày trong tuần tiếng Việt
 */
function getDayOfWeekVN(dayNum) {
  const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  return days[dayNum];
}

// ==================== PHÂN LOẠI TIN NHẮN ====================

/**
 * Phân tích tin nhắn tự do → trả về JSON phân loại
 */
async function classifyMessage(msg, userClasses = [], chatHistory = []) {
  const systemPrompt = buildSystemPrompt(userClasses);

  const prompt = `${systemPrompt}

LỊCH SỬ HỘI THOẠI GẦN NHẤT:
${chatHistory.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`).join('\n')}

TIN NHẮN MỚI CỦA USER: "${msg}"

Phân tích tin nhắn và trả về JSON:
{
  "type": "expense|income|teaching|personal|activity|schedule|task|attendance|tuition|setup|mixed|question|unknown",
  "items": [
    {
      "type": "...",
      "title": "tiêu đề ngắn",
      "content": "nội dung đầy đủ",
      "date": "YYYY-MM-DD hoặc null",
      "time": "HH:MM hoặc null",
      "deadline": "YYYY-MM-DD hoặc null",
      "amount": số hoặc null,
      "category": "... hoặc null",
      "class_id": "... hoặc null",
      "subject": "... hoặc null",
      "lesson": "... hoặc null",
      "priority": "high|medium|low|null",
      "has_reminder": true/false,
      "reminder_type": "day_before|morning|custom|null",
      "reminder_time": "HH:MM hoặc null"
    }
  ],
  "needs_confirmation": true/false,
  "response_to_user": "câu trả lời thân thiện tiếng Việt"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    console.log('Gemini raw response:', text.substring(0, 300));
    const json = extractJSON(text);
    console.log('Gemini parsed type:', json?.type);
    return json;
  } catch (err) {
    console.error('Gemini classifyMessage error:', JSON.stringify({ message: err.message, status: err.status, code: err.code, details: err.errorDetails }));
    return {
      type: 'unknown',
      items: [],
      needs_confirmation: false,
      response_to_user: 'Mình chưa hiểu rõ ý bạn, bạn nói lại được không? 😅',
    };
  }
}

// ==================== ĐIỂM DANH ====================

/**
 * Phân tích tin nhắn điểm danh
 */
async function parseAttendance(msg, classData) {
  const studentList = classData.students?.map(s => s.name).join(', ') || '';

  const prompt = `Phân tích tin nhắn điểm danh sau:
"${msg}"

Lớp: ${classData.display_name}
Danh sách học sinh: ${studentList}

Trả về JSON:
{
  "class_id": "${classData.id}",
  "class_name": "${classData.display_name}",
  "session_hint": "thu_3|thu_6|null (buổi nào nếu có đề cập)",
  "present_all": true/false,
  "absent_names": ["tên vắng 1", "tên vắng 2"],
  "absent_reasons": {"tên": "phep|khong_phep|null"},
  "pre_reported": false,
  "note": "ghi chú nếu có"
}`;

  try {
    const result = await model.generateContent(prompt);
    return extractJSON(result.response.text());
  } catch (err) {
    console.error('Gemini parseAttendance error:', err.message);
    return null;
  }
}

/**
 * Match tên học sinh với danh sách (tìm gần đúng)
 */
async function matchStudentNames(absentNames, studentList) {
  if (!absentNames || absentNames.length === 0) return [];

  const prompt = `Danh sách học sinh trong lớp:
${studentList.map((s, i) => `${i + 1}. ${s.name} (id: ${s.id})`).join('\n')}

Tên được nhắc đến (có thể viết tắt hoặc sai dấu):
${absentNames.join(', ')}

Match từng tên với danh sách học sinh. Trả về JSON array:
[
  {
    "input_name": "tên người nhập",
    "matched_id": "id học sinh hoặc null",
    "matched_name": "tên đầy đủ hoặc null",
    "confidence": "high|low",
    "ambiguous": true/false,
    "candidates": ["nếu có nhiều khả năng"]
  }
]`;

  try {
    const result = await model.generateContent(prompt);
    return extractJSON(result.response.text());
  } catch (err) {
    console.error('Gemini matchStudentNames error:', err.message);
    return absentNames.map(n => ({
      input_name: n,
      matched_id: null,
      matched_name: null,
      confidence: 'low',
      ambiguous: false,
      candidates: [],
    }));
  }
}

// ==================== HỌC PHÍ ====================

/**
 * Phân tích tin nhắn thu học phí
 */
async function parseTuition(msg, allClasses) {
  const classInfo = allClasses.map(c =>
    `- ${c.display_name} (id: ${c.id}): ${c.students?.map(s => `${s.name} hp:${s.fee}`).join(', ')}`
  ).join('\n');

  const prompt = `Phân tích tin nhắn thu học phí:
"${msg}"

Danh sách lớp và học sinh:
${classInfo}

Trả về JSON:
{
  "month": "YYYY-MM",
  "items": [
    {
      "student_name": "tên đầy đủ",
      "student_id": "id hoặc null",
      "class_id": "id lớp hoặc null",
      "class_name": "tên lớp",
      "amount": số tiền (null nếu lấy từ fee mặc định),
      "method": "ck_vo|ck_chong|tien_mat|other",
      "method_note": "ghi chú hình thức",
      "note": ""
    }
  ]
}`;

  try {
    const result = await model.generateContent(prompt);
    return extractJSON(result.response.text());
  } catch (err) {
    console.error('Gemini parseTuition error:', err.message);
    return null;
  }
}

// ==================== SETUP LỚP ====================

/**
 * Phân tích tin nhắn setup lớp học
 */
async function parseClassSetup(msg) {
  const currentDate = dayjs().format('YYYY-MM-DD');

  const prompt = `Phân tích tin nhắn setup lớp học sau và trả về JSON.

Tin nhắn: "${msg}"

Quy tắc:
- action: "create" nếu tạo lớp mới, "update" nếu cập nhật, "add_student" nếu thêm HS, "remove_student" nếu xóa HS
- class_id: viết thường, không dấu, dùng dấu gạch dưới (ví dụ: "tin35", "tin_3_5", "python46")
- sessions: CHỈ các buổi lớp HỌC, map từ thứ: thứ 2→"thu_2", thứ 3→"thu_3", thứ 4→"thu_4", thứ 5→"thu_5", thứ 6→"thu_6", thứ 7→"thu_7", chủ nhật→"chu_nhat"
- students: mảng học sinh với fee là học phí/tháng (số nguyên)
- Nếu tất cả HS cùng lịch → sessions của từng HS = sessions của lớp

Ví dụ input: "setup lớp tin35\nlịch thứ 3 + thứ 5\nhọc phí: 450000\nhọc sinh: An, Bình"
Ví dụ output:
{
  "action": "create",
  "class_id": "tin35",
  "display_name": "Tin35",
  "subject": "Tin học",
  "sessions": ["thu_3", "thu_5"],
  "students": [
    {"id": "s001", "name": "An", "main_class": null, "sessions": ["thu_3", "thu_5"], "fee": 450000, "note": ""},
    {"id": "s002", "name": "Bình", "main_class": null, "sessions": ["thu_3", "thu_5"], "fee": 450000, "note": ""}
  ],
  "response_to_user": "Đã tạo lớp Tin35 với 2 học sinh!"
}

Trả về JSON hợp lệ, không thêm text ngoài JSON.`;

  try {
    const result = await model.generateContent(prompt);
    return extractJSON(result.response.text());
  } catch (err) {
    console.error('Gemini parseClassSetup error:', err.message);
    return null;
  }
}

// ==================== TÌM KIẾM & TỔNG HỢP ====================

/**
 * Phân tích câu hỏi tìm kiếm → xác định collection và điều kiện query
 */
async function analyzeQuery(query) {
  const currentDate = dayjs().format('YYYY-MM-DD');
  const currentMonth = dayjs().format('YYYY-MM');

  const prompt = `Phân tích câu hỏi tìm kiếm sau để xác định cần query dữ liệu gì:
"${query}"

Ngày hiện tại: ${currentDate}
Tháng hiện tại: ${currentMonth}

Trả về JSON:
{
  "collections": ["entries", "attendance", "tuition"],
  "month": "YYYY-MM hoặc null",
  "date": "YYYY-MM-DD hoặc null",
  "date_from": "YYYY-MM-DD hoặc null",
  "date_to": "YYYY-MM-DD hoặc null",
  "type": "expense|income|teaching|personal|activity|schedule|task|null",
  "keywords": ["từ khóa liên quan"],
  "intent": "find_latest|summarize|count|compare|find_specific",
  "class_id": "id lớp hoặc null"
}`;

  try {
    const result = await model.generateContent(prompt);
    return extractJSON(result.response.text()) || { collections: ['entries'], intent: 'find_specific', keywords: [query] };
  } catch (err) {
    console.error('Gemini analyzeQuery error:', err.message);
    return { collections: ['entries'], intent: 'find_specific', keywords: [query] };
  }
}

/**
 * Tìm kiếm và trả lời dựa trên dữ liệu thực
 */
async function searchAndAnswer(data, query) {
  const prompt = `Dựa vào dữ liệu sau, hãy trả lời câu hỏi của user.

CÂU HỎI: "${query}"

DỮ LIỆU:
${JSON.stringify(data, null, 2)}

Yêu cầu:
- Trả lời bằng tiếng Việt, thân thiện
- Kèm ngày cụ thể khi trả lời
- Tóm tắt súc tích, dùng emoji
- Nếu không tìm thấy → nói rõ và gợi ý

Chỉ trả về text thuần, không cần JSON.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini searchAndAnswer error:', err.message);
    return 'Mình không tìm được thông tin này, bạn thử hỏi cách khác nhé! 😅';
  }
}

/**
 * Tổng hợp nhật ký theo tháng/khoảng thời gian
 */
async function summarizeDiary(entries, attendance, tuition, query, period) {
  const prompt = `Bạn là trợ lý cá nhân của một giáo viên Tin học tiểu học.
Hãy tổng hợp nhật ký ${period} dựa trên dữ liệu dưới đây.

YÊU CẦU: "${query}"

ENTRIES (hoạt động, ghi chép):
${JSON.stringify(entries, null, 2)}

ĐIỂM DANH:
${JSON.stringify(attendance, null, 2)}

HỌC PHÍ:
${JSON.stringify(tuition, null, 2)}

Viết tổng hợp theo format:
📖 *Nhật ký ${period}*

[Đoạn mở đầu tóm tắt chung 1-2 câu]

✅ *Nổi bật:*
• [điểm 1]
• [điểm 2]

📚 *Dạy học:*
• [thông tin giảng dạy]

💰 *Tài chính:*
• Thu: ... | Chi: ...

[Nếu có nhật ký cá nhân thì thêm phần cảm xúc/suy nghĩ]

😔 *Khó khăn:* (nếu có)
• [điểm khó khăn]

Viết tự nhiên, cảm xúc, như người bạn đồng nghiệp nhận xét.
Chỉ trả về text, không cần JSON.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini summarizeDiary error:', err.message);
    return 'Mình chưa tổng hợp được nhật ký lúc này, bạn thử lại nhé! 😅';
  }
}

/**
 * Tạo tổng kết weekly review
 */
async function generateWeeklyReview(entries, attendance, tuition, week) {
  const prompt = `Tạo tổng kết tuần ${week} cho giáo viên.

ENTRIES:
${JSON.stringify(entries, null, 2)}

ĐIỂM DANH:
${JSON.stringify(attendance, null, 2)}

HỌC PHÍ ĐÃ THU:
${JSON.stringify(tuition, null, 2)}

Trả về JSON:
{
  "summary_text": "tóm tắt tuần bằng tiếng Việt, dùng Markdown Telegram",
  "stats": {
    "teaching_sessions": số buổi dạy,
    "total_students_taught": tổng lượt HS,
    "income": tổng thu,
    "expense": tổng chi,
    "tasks_done": số task xong,
    "tasks_pending": số task chưa xong
  },
  "highlights": ["điểm nổi bật 1", "điểm nổi bật 2"],
  "next_week_reminders": ["việc cần làm tuần tới"]
}`;

  try {
    const result = await model.generateContent(prompt);
    return extractJSON(result.response.text());
  } catch (err) {
    console.error('Gemini generateWeeklyReview error:', err.message);
    return null;
  }
}

// ==================== BÁO CÁO ====================

/**
 * Tạo báo cáo chi tiết theo loại
 */
async function generateReport(type, data, month) {
  const reportTypes = {
    chitieu: 'Báo cáo chi tiêu - phân loại theo category',
    hocphi: 'Báo cáo học phí - tổng hợp theo lớp, ai đã đóng/chưa đóng',
    diemdanh: 'Báo cáo chuyên cần - thống kê vắng mặt từng HS, từng lớp',
    giangday: 'Báo cáo giảng dạy - số buổi, lớp, nội dung',
    congviec: 'Báo cáo công việc - task done/pending/cancelled',
    tonghop: 'Báo cáo tổng hợp tất cả',
  };

  const prompt = `Tạo ${reportTypes[type] || 'báo cáo'} cho tháng ${month}.

DỮ LIỆU:
${JSON.stringify(data, null, 2)}

Trả về báo cáo dạng text Markdown Telegram, súc tích, có số liệu cụ thể.
Dùng emoji phù hợp. Chỉ trả về text.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini generateReport error:', err.message);
    return 'Không tạo được báo cáo lúc này, bạn thử lại nhé!';
  }
}

// ==================== HELPER ====================

/**
 * Trích xuất JSON từ response text của Gemini
 */
function extractJSON(text) {
  // Loại bỏ phần thinking của gemini-2.5 trước khi parse
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  try {
    // Thử parse trực tiếp
    return JSON.parse(text);
  } catch {
    // Tìm JSON block trong markdown
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch {}
    }
    // Tìm {} hoặc [] đầu tiên
    const objMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[1]);
      } catch {}
    }
    console.error('extractJSON failed:', text.substring(0, 200));
    return null;
  }
}

module.exports = {
  classifyMessage,
  parseAttendance,
  matchStudentNames,
  parseTuition,
  parseClassSetup,
  analyzeQuery,
  searchAndAnswer,
  summarizeDiary,
  generateWeeklyReview,
  generateReport,
  buildSystemPrompt,
};
