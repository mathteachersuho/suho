/**
 * ===== 수학 클래스룸 앱 - 구글시트 연동 Apps Script (선생님 문제 보관함 추가판) =====
 *
 * 이 버전에서 새로 생긴 것 (문제 은행판):
 *   - 문제 은행 'bank' 탭: 학생과 상관없이 한 문제씩 저장 (학년 › 단원 › 유형 › 문제틀 + 난이도 + 검수 표시)
 *   - 유형표 'taxonomy' 탭: 문제틀 이름과 설명, 이름 바꾸기·옮기기·합치기
 *   - 예전 보관함(archive) 문제를 문제 은행으로 옮기기
 *
 * 이전 버전에서 생긴 것:
 *   1. 선생님 문제 보관함 - 'archive' 탭에 저장
 *      날짜 / 대상 학생(여러 명) / 반 / 학년 › 단원 › 세부 유형 별로 오래 쌓아두고 검색한다.
 *   2. 원본 사진은 시트 칸이 아니라 구글 드라이브 폴더('수학클래스룸_원본사진')에 저장하고,
 *      시트에는 파일 ID만 남긴다. 그래서 문제가 수만 개 쌓여도 시트가 무거워지지 않는다.
 *   3. 학생별·유형별 문제 개수 통계
 *   기존 기능(게시판, 학생 계정, 개인보관함, ON/OFF 스위치)은 그대로다.
 *   새 탭과 드라이브 폴더는 처음 쓸 때 자동으로 만들어진다.
 *
 * [설치 방법]
 * 1. 기존 코드를 전부 지우고 이 파일 내용을 붙여넣기
 * 2. 스크립트 속성의 SECRET_TOKEN은 그대로 두면 됨 (Streamlit Secrets의 SHEET_API_TOKEN과 동일한 값)
 * 3. [배포] > [배포 관리] > 연필 아이콘 > 새 버전으로 재배포
 *    이번 버전은 구글 드라이브를 사용하므로, 재배포할 때 "드라이브 접근 권한"을 묻는 창이 뜨면 허용해 주세요.
 */

var PROBLEMS_HEADERS = ['id', 'class_id', 'date', 'image_b64', 'q1', 'a1', 's1', 'q2', 'a2', 's2'];
var STUDENTS_HEADERS = ['student_id', 'password_hash', 'class_id', 'created_at'];
var PERSONAL_HEADERS = ['id', 'student_id', 'class_id', 'source', 'origin_id', 'date', 'image_b64', 'q1', 'a1', 's1', 'q2', 'a2', 's2'];
// student_ids: 쉼표로 구분한 학생 아이디 목록 (예: "kim01,lee02")
var ARCHIVE_HEADERS = ['id', 'date', 'student_ids', 'class_id', 'grade', 'unit', 'subtype', 'source_text', 'image_file_id', 'q1', 'a1', 's1', 'q2', 'a2', 's2', 'memo', 'created_at'];
var ARCHIVE_COL = {};
for (var _c = 0; _c < ARCHIVE_HEADERS.length; _c++) ARCHIVE_COL[ARCHIVE_HEADERS[_c]] = _c;

var ARCHIVE_FOLDER_NAME = '수학클래스룸_원본사진';

function getSecretToken_() {
  return PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN') || '';
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 이름으로 시트를 찾고, 없으면 헤더와 함께 새로 만든다 (학생/개인보관함 탭용)
function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

// 기존 문제 게시판 시트: 이름 무관하게 항상 "첫 번째/활성 시트"를 그대로 사용
// (원래 코드와 동일한 방식 - 기존 데이터 위치를 건드리지 않기 위함)
function getProblemsSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
}

// ==========================================
// 진입점
// ==========================================
function doGet(e) {
  var secret = getSecretToken_();
  if (secret && (!e.parameter || e.parameter.token !== secret)) {
    return jsonResponse_({ error: "unauthorized" });
  }

  var action = e.parameter && e.parameter.action;
  var sheetParam = e.parameter && e.parameter.sheet;

  if (action === 'list_students') {
    return handleListStudents_();
  }
  if (action === 'get_status') {
    return handleGetStatus_();
  }
  if (action === 'archive_search') return handleArchiveSearch_(e);
  if (action === 'archive_types') return handleArchiveTypes_();
  if (action === 'archive_stats') return handleArchiveStats_(e);
  if (action === 'archive_image') return handleArchiveImage_(e);
  if (action === 'bank_search') return handleBankSearch_(e);
  if (action === 'taxonomy') return handleTaxonomy_();
  if (sheetParam === 'personal_problems') {
    return handleGetPersonal_(e);
  }
  return handleGetProblems_(e);
}

function doPost(e) {
  var secret = getSecretToken_();
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ error: "invalid_json" });
  }
  if (secret && body._token !== secret) {
    return jsonResponse_({ error: "unauthorized" });
  }

  var action = body.action;
  if (action === 'signup') return handleSignup_(body);
  if (action === 'login') return handleLogin_(body);
  if (action === 'assign_class') return handleAssignClass_(body);
  if (action === 'withdraw') return handleWithdraw_(body);
  if (action === 'save_personal') return handleSavePersonal_(body);
  if (action === 'delete_personal') return handleDeletePersonal_(body);
  if (action === 'set_status') return handleSetStatus_(body);
  if (action === 'archive_save') return handleArchiveSave_(body);
  if (action === 'archive_delete') return handleArchiveDelete_(body);
  if (action === 'archive_update_students') return handleArchiveUpdateStudents_(body);
  if (action === 'bank_save') return handleBankSave_(body);
  if (action === 'bank_update') return handleBankUpdate_(body);
  if (action === 'bank_delete') return handleBankDelete_(body);
  if (action === 'taxonomy_upsert') return handleTaxonomyUpsert_(body);
  if (action === 'taxonomy_rename') return handleTaxonomyRename_(body);
  if (action === 'migrate_archive') return handleMigrateArchive_();
  if (action === 'delete') return handleDeleteProblem_(body);
  return handleInsertProblem_(body); // action 없으면 기존 게시판 등록(기본 동작)
}

// ==========================================
// 문제 게시판 (기존과 동일한 로직 유지)
// ==========================================
function handleGetProblems_(e) {
  var classFilter = (e.parameter && e.parameter.class_id) ? String(e.parameter.class_id) : null;
  var sinceFilter = (e.parameter && e.parameter.since) ? String(e.parameter.since) : null;

  var sheet = getProblemsSheet_();
  var data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) return jsonResponse_([]);

  var startRow = 0;
  var firstVal = String(data[0][0]).toLowerCase();
  var secondVal = String(data[0][1]).toLowerCase();
  if (firstVal.includes('id') || secondVal.includes('class') || secondVal.includes('반')) {
    startRow = 1;
  }

  var rows = [];
  for (var i = startRow; i < data.length; i++) {
    var r = data[i];
    if (!r[0] && !r[1] && !r[4]) continue;

    var rowClass = String(r[1] || "");
    var rowDate = String(r[2] || "");
    if (classFilter && rowClass !== classFilter) continue;
    if (sinceFilter && rowDate < sinceFilter) continue;

    rows.push({
      id: String(r[0] || ""), class_id: rowClass, date: rowDate,
      image_b64: String(r[3] || ""), q1: String(r[4] || ""), a1: String(r[5] || ""),
      s1: String(r[6] || ""), q2: String(r[7] || ""), a2: String(r[8] || ""), s2: String(r[9] || "")
    });
  }
  return jsonResponse_(rows);
}

function handleInsertProblem_(body) {
  var sheet = getProblemsSheet_();
  sheet.appendRow([body.id, body.class_id, body.date, body.image_b64 || "", body.q1, body.a1, body.s1, body.q2, body.a2, body.s2]);
  return jsonResponse_({ status: "success" });
}

function handleDeleteProblem_(body) {
  var sheet = getProblemsSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return jsonResponse_({ status: "deleted" });
}

// ==========================================
// 학생 계정 (students 탭)
// ==========================================
function handleSignup_(body) {
  var studentId = String(body.student_id || '').trim();
  var pwHash = String(body.password_hash || '');
  if (!studentId || !pwHash) {
    return jsonResponse_({ ok: false, error: "아이디/비밀번호를 입력해주세요." });
  }

  var sheet = getOrCreateSheet_('students', STUDENTS_HEADERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === studentId) {
      return jsonResponse_({ ok: false, error: "이미 사용 중인 아이디입니다." });
    }
  }
  sheet.appendRow([studentId, pwHash, "", new Date().toISOString()]);
  return jsonResponse_({ ok: true, class_id: "" });
}

function handleLogin_(body) {
  var studentId = String(body.student_id || '').trim();
  var pwHash = String(body.password_hash || '');

  var sheet = getOrCreateSheet_('students', STUDENTS_HEADERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === studentId) {
      if (String(data[i][1]) === pwHash) {
        return jsonResponse_({ ok: true, class_id: String(data[i][2] || "") });
      }
      return jsonResponse_({ ok: false, error: "비밀번호가 일치하지 않습니다." });
    }
  }
  return jsonResponse_({ ok: false, error: "존재하지 않는 아이디입니다." });
}

function handleAssignClass_(body) {
  var studentId = String(body.student_id || '').trim();
  var classId = String(body.class_id || '').trim();

  var sheet = getOrCreateSheet_('students', STUDENTS_HEADERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === studentId) {
      sheet.getRange(i + 1, 3).setValue(classId); // 3번째 열 = class_id
      return jsonResponse_({ ok: true });
    }
  }
  return jsonResponse_({ ok: false, error: "학생을 찾을 수 없습니다." });
}

// 회원 탈퇴: 계정(students)과 개인 보관함(personal_problems) 데이터를 함께 삭제한다.
// by_admin=true면 선생님이 강제 탈퇴시키는 것이므로 비밀번호 확인을 건너뛴다.
// by_admin이 없거나 false면 본인 탈퇴이므로 반드시 비밀번호가 일치해야 한다.
// (선생님 보관함 'archive'의 문제는 선생님 자료이므로 탈퇴해도 지우지 않는다)
function handleWithdraw_(body) {
  var studentId = String(body.student_id || '').trim();
  if (!studentId) {
    return jsonResponse_({ ok: false, error: "student_id가 필요합니다." });
  }
  var byAdmin = !!body.by_admin;

  var studentsSheet = getOrCreateSheet_('students', STUDENTS_HEADERS);
  var data = studentsSheet.getDataRange().getValues();
  var foundRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === studentId) {
      foundRow = i;
      break;
    }
  }
  if (foundRow === -1) {
    return jsonResponse_({ ok: false, error: "학생을 찾을 수 없습니다." });
  }
  if (!byAdmin) {
    var pwHash = String(body.password_hash || '');
    if (String(data[foundRow][1]) !== pwHash) {
      return jsonResponse_({ ok: false, error: "비밀번호가 일치하지 않습니다." });
    }
  }
  studentsSheet.deleteRow(foundRow + 1);

  // 개인 보관함도 함께 정리 (뒤에서부터 삭제해야 행 번호가 안 꼬임)
  var personalSheet = getOrCreateSheet_('personal_problems', PERSONAL_HEADERS);
  var pData = personalSheet.getDataRange().getValues();
  for (var j = pData.length - 1; j >= 1; j--) {
    if (String(pData[j][1]) === studentId) {
      personalSheet.deleteRow(j + 1);
    }
  }

  return jsonResponse_({ ok: true });
}

function handleListStudents_() {
  var sheet = getOrCreateSheet_('students', STUDENTS_HEADERS);
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    // 비밀번호 해시는 절대 응답에 포함하지 않음
    list.push({ student_id: String(data[i][0]), class_id: String(data[i][2] || "") });
  }
  return jsonResponse_(list);
}

// ==========================================
// 앱 전체 ON/OFF 상태 (수업 중 접속 허용 스위치)
// ==========================================
function handleGetStatus_() {
  var status = PropertiesService.getScriptProperties().getProperty('APP_STATUS') || 'OFF';
  return jsonResponse_({ status: status });
}

function handleSetStatus_(body) {
  var status = String(body.status || 'OFF');
  PropertiesService.getScriptProperties().setProperty('APP_STATUS', status);
  return jsonResponse_({ ok: true });
}

// ==========================================
// 개인 보관함 (personal_problems 탭) - 예전 데이터 열람용으로 유지
// ==========================================
function handleGetPersonal_(e) {
  var studentId = (e.parameter && e.parameter.student_id) ? String(e.parameter.student_id) : null;
  if (!studentId) return jsonResponse_([]);
  var sourceFilter = (e.parameter && e.parameter.source) ? String(e.parameter.source) : null;

  var sheet = getOrCreateSheet_('personal_problems', PERSONAL_HEADERS);
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (String(r[1]) !== studentId) continue;
    if (sourceFilter && String(r[3]) !== sourceFilter) continue;
    rows.push({
      id: String(r[0]), student_id: String(r[1]), class_id: String(r[2] || ""),
      source: String(r[3] || ""), origin_id: String(r[4] || ""), date: String(r[5] || ""),
      image_b64: String(r[6] || ""), q1: String(r[7] || ""), a1: String(r[8] || ""),
      s1: String(r[9] || ""), q2: String(r[10] || ""), a2: String(r[11] || ""), s2: String(r[12] || "")
    });
  }
  return jsonResponse_(rows);
}

function handleSavePersonal_(body) {
  var sheet = getOrCreateSheet_('personal_problems', PERSONAL_HEADERS);
  sheet.appendRow([
    body.id, body.student_id, body.class_id || "", body.source || "self", body.origin_id || "",
    body.date, body.image_b64 || "", body.q1, body.a1, body.s1, body.q2, body.a2, body.s2
  ]);
  return jsonResponse_({ status: "success" });
}

function handleDeletePersonal_(body) {
  var sheet = getOrCreateSheet_('personal_problems', PERSONAL_HEADERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    // 본인 소유 항목만 삭제 가능하도록 student_id도 함께 확인
    if (String(data[i][0]) === String(body.id) && String(data[i][1]) === String(body.student_id)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return jsonResponse_({ status: "deleted" });
}

// ==========================================
// ★ 선생님 문제 보관함 (archive 탭 + 드라이브 사진 폴더)
// ==========================================

// archive 탭을 찾거나 만든다. 처음 만들 때 모든 칸을 "일반 텍스트" 서식으로 지정해서
// 날짜("2026-10-04")나 아이디("0012")가 시트에서 자동으로 날짜/숫자로 바뀌지 않게 한다.
function getArchiveSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('archive');
  if (!sheet) {
    sheet = ss.insertSheet('archive');
    sheet.getRange(1, 1, 1, ARCHIVE_HEADERS.length).setValues([ARCHIVE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getArchiveFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('ARCHIVE_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      // 폴더가 지워졌으면 아래에서 새로 만든다
    }
  }
  var folder = DriveApp.createFolder(ARCHIVE_FOLDER_NAME);
  props.setProperty('ARCHIVE_FOLDER_ID', folder.getId());
  return folder;
}

// 시트에 '='로 시작하는 글자가 들어가면 수식으로 해석되므로 앞에 '를 붙여 막는다
function safeCell_(v) {
  var s = (v === null || v === undefined) ? '' : String(v);
  if (s.charAt(0) === '=') {
    return "'" + s;
  }
  return s;
}

function cellStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }
  return (v === null || v === undefined) ? '' : String(v);
}

function splitIds_(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}

function archiveRowToObj_(r, includeSource) {
  var o = {};
  for (var k = 0; k < ARCHIVE_HEADERS.length; k++) {
    var h = ARCHIVE_HEADERS[k];
    if (h === 'source_text' && !includeSource) continue;
    o[h] = cellStr_(r[k]);
  }
  return o;
}

function handleArchiveSave_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var fileId = '';
    if (body.image_b64) {
      var blob = Utilities.newBlob(Utilities.base64Decode(body.image_b64), 'image/jpeg', 'archive_' + body.id + '.jpg');
      fileId = getArchiveFolder_().createFile(blob).getId();
    }
    var studentIds = splitIds_(body.student_ids).join(',');
    var row = [
      body.id, body.date, studentIds, body.class_id, body.grade, body.unit, body.subtype,
      body.source_text, fileId, body.q1, body.a1, body.s1, body.q2, body.a2, body.s2,
      body.memo, new Date().toISOString()
    ].map(safeCell_);
    // appendRow 대신 서식을 먼저 "일반 텍스트"로 지정한 뒤 값을 넣는다 (1000행을 넘어가도 날짜/아이디가 변형되지 않게)
    var sheet = getArchiveSheet_();
    var range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length);
    range.setNumberFormat('@');
    range.setValues([row]);
    return jsonResponse_({ ok: true, image_file_id: fileId });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function handleArchiveDelete_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getArchiveSheet_();
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][ARCHIVE_COL.id]) === String(body.id)) {
        var fileId = String(data[i][ARCHIVE_COL.image_file_id] || '');
        if (fileId) {
          try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { /* 이미 없는 파일 */ }
        }
        sheet.deleteRow(i + 1);
        return jsonResponse_({ ok: true });
      }
    }
    return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
  } finally {
    lock.releaseLock();
  }
}

// 이미 보관한 문제에 대상 학생을 바꾸거나 추가할 때
function handleArchiveUpdateStudents_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getArchiveSheet_();
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ARCHIVE_COL.id]) === String(body.id)) {
        sheet.getRange(i + 1, ARCHIVE_COL.student_ids + 1).setValue(splitIds_(body.student_ids).join(','));
        return jsonResponse_({ ok: true });
      }
    }
    return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
  } finally {
    lock.releaseLock();
  }
}

// 검색: 최신순으로 조건에 맞는 문제를 offset부터 limit개 돌려준다.
// 조건: student, class_id, grade, unit, subtype, date_from, date_to(YYYY-MM-DD), keyword
function handleArchiveSearch_(e) {
  var p = e.parameter || {};
  var student = p.student ? String(p.student) : '';
  var classId = p.class_id ? String(p.class_id) : '';
  var grade = p.grade ? String(p.grade) : '';
  var unit = p.unit ? String(p.unit) : '';
  var subtype = p.subtype ? String(p.subtype) : '';
  var dateFrom = p.date_from ? String(p.date_from) : '';
  var dateTo = p.date_to ? String(p.date_to) + '~' : '';  // '~'는 시각이 붙은 같은 날짜도 포함시키기 위함
  var keyword = p.keyword ? String(p.keyword).toLowerCase() : '';
  var offset = parseInt(p.offset || '0', 10) || 0;
  var limit = Math.min(parseInt(p.limit || '30', 10) || 30, 200);

  var data = getArchiveSheet_().getDataRange().getValues();
  var items = [];
  var total = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var r = data[i];
    if (!r[ARCHIVE_COL.id]) continue;
    var d = cellStr_(r[ARCHIVE_COL.date]);
    if (dateFrom && d < dateFrom) continue;
    if (dateTo && d > dateTo) continue;
    if (classId && cellStr_(r[ARCHIVE_COL.class_id]) !== classId) continue;
    if (grade && cellStr_(r[ARCHIVE_COL.grade]) !== grade) continue;
    if (unit && cellStr_(r[ARCHIVE_COL.unit]) !== unit) continue;
    if (subtype && cellStr_(r[ARCHIVE_COL.subtype]) !== subtype) continue;
    if (student && splitIds_(r[ARCHIVE_COL.student_ids]).indexOf(student) === -1) continue;
    if (keyword) {
      var hay = (cellStr_(r[ARCHIVE_COL.q1]) + ' ' + cellStr_(r[ARCHIVE_COL.q2]) + ' ' +
                 cellStr_(r[ARCHIVE_COL.source_text]) + ' ' + cellStr_(r[ARCHIVE_COL.memo])).toLowerCase();
      if (hay.indexOf(keyword) === -1) continue;
    }
    if (total >= offset && items.length < limit) {
      items.push(archiveRowToObj_(r, true));
    }
    total++;
  }
  return jsonResponse_({ items: items, total: total });
}

// 지금까지 쓰인 유형 목록 (학년 › 단원 › 세부 유형) 과 각 개수
function handleArchiveTypes_() {
  var data = getArchiveSheet_().getDataRange().getValues();
  var seen = {};
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var g = cellStr_(data[i][ARCHIVE_COL.grade]);
    var u = cellStr_(data[i][ARCHIVE_COL.unit]);
    var s = cellStr_(data[i][ARCHIVE_COL.subtype]);
    if (!g && !u && !s) continue;
    var key = g + '\u0001' + u + '\u0001' + s;
    if (!seen[key]) {
      seen[key] = { grade: g, unit: u, subtype: s, count: 0 };
      list.push(seen[key]);
    }
    seen[key].count++;
  }
  return jsonResponse_(list);
}

// 학생별·유형별 개수. 기간(date_from, date_to)과 반(class_id)으로 좁힐 수 있다.
function handleArchiveStats_(e) {
  var p = e.parameter || {};
  var dateFrom = p.date_from ? String(p.date_from) : '';
  var dateTo = p.date_to ? String(p.date_to) + '~' : '';
  var classId = p.class_id ? String(p.class_id) : '';

  var data = getArchiveSheet_().getDataRange().getValues();
  var counts = {};
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[ARCHIVE_COL.id]) continue;
    var d = cellStr_(r[ARCHIVE_COL.date]);
    if (dateFrom && d < dateFrom) continue;
    if (dateTo && d > dateTo) continue;
    if (classId && cellStr_(r[ARCHIVE_COL.class_id]) !== classId) continue;
    var ids = splitIds_(r[ARCHIVE_COL.student_ids]);
    if (ids.length === 0) ids = ['(학생 미지정)'];
    for (var j = 0; j < ids.length; j++) {
      var key = [ids[j], cellStr_(r[ARCHIVE_COL.grade]), cellStr_(r[ARCHIVE_COL.unit]), cellStr_(r[ARCHIVE_COL.subtype])].join('\u0001');
      if (!counts[key]) {
        counts[key] = { student_id: ids[j], grade: cellStr_(r[ARCHIVE_COL.grade]), unit: cellStr_(r[ARCHIVE_COL.unit]),
                        subtype: cellStr_(r[ARCHIVE_COL.subtype]), count: 0, last_date: '' };
        rows.push(counts[key]);
      }
      counts[key].count++;
      if (d > counts[key].last_date) counts[key].last_date = d;
    }
  }
  return jsonResponse_(rows);
}

// 보관된 원본 사진을 base64로 돌려준다. 보관함 폴더 안의 파일만 허용한다.
function handleArchiveImage_(e) {
  var fileId = (e.parameter && e.parameter.file_id) ? String(e.parameter.file_id) : '';
  if (!fileId) return jsonResponse_({ ok: false, error: "file_id가 필요합니다." });
  try {
    var file = DriveApp.getFileById(fileId);
    var folderId = getArchiveFolder_().getId();
    var parents = file.getParents();
    var inFolder = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === folderId) { inFolder = true; break; }
    }
    if (!inFolder) return jsonResponse_({ ok: false, error: "보관함 사진이 아닙니다." });
    return jsonResponse_({ ok: true, image_b64: Utilities.base64Encode(file.getBlob().getBytes()) });
  } catch (err) {
    return jsonResponse_({ ok: false, error: "사진을 찾을 수 없습니다." });
  }
}

// ==========================================
// ★ 문제 은행 (bank 탭) + 유형표 (taxonomy 탭)
// 문제를 학생과 상관없이 한 문제씩 저장한다.
// 분류: 학년 › 단원 › 유형 › 문제틀(숫자·난이도만 다른 문제들의 묶음) + 난이도(하/중/상)
// ==========================================
var BANK_HEADERS = ['id', 'created_at', 'grade', 'unit', 'type', 'frame', 'difficulty', 'source', 'origin_id',
                    'question', 'answer', 'solution', 'image_file_id', 'verified', 'memo', 'legacy_archive_id'];
var BANK_COL = {};
for (var _b = 0; _b < BANK_HEADERS.length; _b++) BANK_COL[BANK_HEADERS[_b]] = _b;
var TAXONOMY_HEADERS = ['grade', 'unit', 'type', 'frame', 'description', 'created_at'];
var TAX_LEVELS = ['grade', 'unit', 'type', 'frame'];

function getTextSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var hr = sheet.getRange(1, 1, 1, headers.length);
    hr.setNumberFormat('@');
    hr.setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 서식을 "일반 텍스트"로 지정한 뒤 여러 줄을 한 번에 추가한다
function appendTextRows_(sheet, rows) {
  if (!rows.length) return;
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length);
  range.setNumberFormat('@');
  range.setValues(rows.map(function (r) { return r.map(safeCell_); }));
}

function taxKey_(o) {
  return [o.grade || '', o.unit || '', o.type || '', o.frame || ''].join('\u0001');
}

function bankRowToObj_(r) {
  var o = {};
  for (var k = 0; k < BANK_HEADERS.length; k++) o[BANK_HEADERS[k]] = cellStr_(r[k]);
  return o;
}

// 유형표에 없는 (학년, 단원, 유형, 문제틀)이면 추가한다
function ensureTaxonomy_(entries) {
  var sheet = getTextSheet_('taxonomy', TAXONOMY_HEADERS);
  var data = sheet.getDataRange().getValues();
  var seen = {};
  for (var i = 1; i < data.length; i++) {
    seen[taxKey_({ grade: cellStr_(data[i][0]), unit: cellStr_(data[i][1]), type: cellStr_(data[i][2]), frame: cellStr_(data[i][3]) })] = true;
  }
  var add = [];
  var now = new Date().toISOString();
  for (var j = 0; j < entries.length; j++) {
    var e = entries[j];
    var key = taxKey_(e);
    if (!e.frame || seen[key]) continue;
    seen[key] = true;
    add.push([e.grade || '', e.unit || '', e.type || '', e.frame || '', e.description || '', now]);
  }
  appendTextRows_(sheet, add);
}

// 여러 문제를 한 번에 저장. body.problems = [{grade, unit, type, frame, frame_description, difficulty, source,
//   question, answer, solution, verified, memo, use_image}], body.image_b64 = 원본 사진(선택)
function handleBankSave_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var problems = body.problems || [];
    if (!problems.length) return jsonResponse_({ ok: false, error: "저장할 문제가 없습니다." });
    var fileId = '';
    if (body.image_b64) {
      var blob = Utilities.newBlob(Utilities.base64Decode(body.image_b64), 'image/jpeg', 'bank_' + body.group_id + '.jpg');
      fileId = getArchiveFolder_().createFile(blob).getId();
    }
    var now = new Date().toISOString();
    var base = String(body.group_id || new Date().getTime());
    var rows = [];
    var ids = [];
    var originId = '';
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      var id = base + '_' + (i + 1);
      if (p.source === '원본') originId = id;
      ids.push(id);
      rows.push([id, now, p.grade, p.unit, p.type, p.frame, p.difficulty, p.source,
                 p.source === '원본' ? '' : originId, p.question, p.answer, p.solution,
                 p.use_image ? fileId : '', p.verified ? 'Y' : '', p.memo, '']);
    }
    appendTextRows_(getTextSheet_('bank', BANK_HEADERS), rows);
    ensureTaxonomy_(problems.map(function (p) {
      return { grade: p.grade, unit: p.unit, type: p.type, frame: p.frame, description: p.frame_description };
    }));
    return jsonResponse_({ ok: true, ids: ids, image_file_id: fileId });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 한 문제의 일부 칸만 고친다 (body.fields = {question: ..., verified: 'Y', ...})
function handleBankUpdate_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getTextSheet_('bank', BANK_HEADERS);
    var data = sheet.getDataRange().getValues();
    var editable = ['grade', 'unit', 'type', 'frame', 'difficulty', 'question', 'answer', 'solution', 'verified', 'memo'];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][BANK_COL.id]) !== String(body.id)) continue;
      var fields = body.fields || {};
      for (var k = 0; k < editable.length; k++) {
        var f = editable[k];
        if (fields.hasOwnProperty(f)) {
          var cell = sheet.getRange(i + 1, BANK_COL[f] + 1);
          cell.setNumberFormat('@');
          cell.setValue(safeCell_(fields[f]));
        }
      }
      if (fields.frame) ensureTaxonomy_([{ grade: fields.grade, unit: fields.unit, type: fields.type, frame: fields.frame }]);
      return jsonResponse_({ ok: true });
    }
    return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
  } finally {
    lock.releaseLock();
  }
}

function handleBankDelete_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getTextSheet_('bank', BANK_HEADERS);
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][BANK_COL.id]) !== String(body.id)) continue;
      var fileId = cellStr_(data[i][BANK_COL.image_file_id]);
      sheet.deleteRow(i + 1);
      // 같은 사진을 쓰는 다른 문제가 없을 때만 사진도 휴지통으로
      if (fileId) {
        var used = false;
        for (var j = 1; j < data.length; j++) {
          if (j !== i && cellStr_(data[j][BANK_COL.image_file_id]) === fileId) { used = true; break; }
        }
        if (!used) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { } }
      }
      return jsonResponse_({ ok: true });
    }
    return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
  } finally {
    lock.releaseLock();
  }
}

// 검색: grade, unit, type, frame, difficulty(쉼표로 여러 개), verified=Y, source, keyword, ids(쉼표), offset, limit
function handleBankSearch_(e) {
  var p = e.parameter || {};
  var exact = {};
  ['grade', 'unit', 'type', 'frame', 'source'].forEach(function (f) { if (p[f]) exact[f] = String(p[f]); });
  var diffs = p.difficulty ? String(p.difficulty).split(',') : null;
  var verifiedOnly = p.verified === 'Y';
  var keyword = p.keyword ? String(p.keyword).toLowerCase() : '';
  var idSet = null;
  if (p.ids) { idSet = {}; String(p.ids).split(',').forEach(function (x) { idSet[x.trim()] = true; }); }
  var offset = parseInt(p.offset || '0', 10) || 0;
  var limit = Math.min(parseInt(p.limit || '50', 10) || 50, 500);

  var data = getTextSheet_('bank', BANK_HEADERS).getDataRange().getValues();
  var items = [];
  var total = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var r = data[i];
    if (!r[BANK_COL.id]) continue;
    if (idSet && !idSet[cellStr_(r[BANK_COL.id])]) continue;
    var skip = false;
    for (var f in exact) { if (cellStr_(r[BANK_COL[f]]) !== exact[f]) { skip = true; break; } }
    if (skip) continue;
    if (diffs && diffs.indexOf(cellStr_(r[BANK_COL.difficulty])) === -1) continue;
    if (verifiedOnly && cellStr_(r[BANK_COL.verified]) !== 'Y') continue;
    if (keyword) {
      var hay = (cellStr_(r[BANK_COL.question]) + ' ' + cellStr_(r[BANK_COL.memo]) + ' ' + cellStr_(r[BANK_COL.frame])).toLowerCase();
      if (hay.indexOf(keyword) === -1) continue;
    }
    if (total >= offset && items.length < limit) items.push(bankRowToObj_(r));
    total++;
  }
  return jsonResponse_({ items: items, total: total });
}

// 유형표 + 문제틀마다 문제 수 / 검수 완료 수 / 난이도별 수
function handleTaxonomy_() {
  var tax = getTextSheet_('taxonomy', TAXONOMY_HEADERS).getDataRange().getValues();
  var bank = getTextSheet_('bank', BANK_HEADERS).getDataRange().getValues();
  var map = {};
  var list = [];
  function entry(g, u, t, f, d) {
    var key = taxKey_({ grade: g, unit: u, type: t, frame: f });
    if (!map[key]) {
      map[key] = { grade: g, unit: u, type: t, frame: f, description: d || '', count: 0, verified: 0, '하': 0, '중': 0, '상': 0 };
      list.push(map[key]);
    } else if (d && !map[key].description) {
      map[key].description = d;
    }
    return map[key];
  }
  for (var i = 1; i < tax.length; i++) {
    if (!tax[i][3]) continue;
    entry(cellStr_(tax[i][0]), cellStr_(tax[i][1]), cellStr_(tax[i][2]), cellStr_(tax[i][3]), cellStr_(tax[i][4]));
  }
  for (var j = 1; j < bank.length; j++) {
    var r = bank[j];
    if (!r[BANK_COL.id]) continue;
    var en = entry(cellStr_(r[BANK_COL.grade]), cellStr_(r[BANK_COL.unit]), cellStr_(r[BANK_COL.type]), cellStr_(r[BANK_COL.frame]), '');
    en.count++;
    if (cellStr_(r[BANK_COL.verified]) === 'Y') en.verified++;
    var d = cellStr_(r[BANK_COL.difficulty]);
    if (en.hasOwnProperty(d)) en[d]++;
  }
  return jsonResponse_(list);
}

// 문제틀 설명 추가/수정 (없으면 새로 만든다)
function handleTaxonomyUpsert_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getTextSheet_('taxonomy', TAXONOMY_HEADERS);
    var data = sheet.getDataRange().getValues();
    var key = taxKey_(body);
    for (var i = 1; i < data.length; i++) {
      var k = taxKey_({ grade: cellStr_(data[i][0]), unit: cellStr_(data[i][1]), type: cellStr_(data[i][2]), frame: cellStr_(data[i][3]) });
      if (k === key) {
        var cell = sheet.getRange(i + 1, 5);
        cell.setNumberFormat('@');
        cell.setValue(safeCell_(body.description || ''));
        return jsonResponse_({ ok: true });
      }
    }
    ensureTaxonomy_([body]);
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 이름 바꾸기 / 옮기기 / 합치기.
// level = 'grade' | 'unit' | 'type' | 'frame'. old_* 로 고른 묶음(그 아래 전부)의 이름을 new_* 로 바꾼다.
// 바꾼 이름이 이미 있으면 자연스럽게 합쳐진다.
function handleTaxonomyRename_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var depth = TAX_LEVELS.indexOf(body.level || 'frame') + 1;
    if (depth < 1) return jsonResponse_({ ok: false, error: "level이 올바르지 않습니다." });
    var oldVals = TAX_LEVELS.slice(0, depth).map(function (l) { return String(body['old_' + l] || ''); });
    var newVals = TAX_LEVELS.slice(0, depth).map(function (l) { return String(body['new_' + l] || ''); });
    var changed = 0;

    function renameIn(sheet, cols) {
      var range = sheet.getDataRange();
      var data = range.getValues();
      var dirty = false;
      for (var i = 1; i < data.length; i++) {
        var match = true;
        for (var d = 0; d < depth; d++) { if (cellStr_(data[i][cols[d]]) !== oldVals[d]) { match = false; break; } }
        if (!match) continue;
        for (var d2 = 0; d2 < depth; d2++) data[i][cols[d2]] = newVals[d2];
        dirty = true;
        changed++;
      }
      if (dirty) {
        for (var c = 0; c < depth; c++) {
          var colVals = data.slice(1).map(function (row) { return [cellStr_(row[cols[c]])]; });
          var colRange = sheet.getRange(2, cols[c] + 1, colVals.length, 1);
          colRange.setNumberFormat('@');
          colRange.setValues(colVals);
        }
      }
    }
    renameIn(getTextSheet_('bank', BANK_HEADERS), [BANK_COL.grade, BANK_COL.unit, BANK_COL.type, BANK_COL.frame]);
    renameIn(getTextSheet_('taxonomy', TAXONOMY_HEADERS), [0, 1, 2, 3]);

    // 합쳐져서 같은 유형표 줄이 두 개가 되면 하나만 남긴다
    var tsheet = getTextSheet_('taxonomy', TAXONOMY_HEADERS);
    var tdata = tsheet.getDataRange().getValues();
    var firstRow = {};
    var toDelete = [];
    for (var i = 1; i < tdata.length; i++) {
      var key = taxKey_({ grade: cellStr_(tdata[i][0]), unit: cellStr_(tdata[i][1]), type: cellStr_(tdata[i][2]), frame: cellStr_(tdata[i][3]) });
      if (firstRow[key] === undefined) { firstRow[key] = i; continue; }
      // 남기는 줄에 설명이 없으면 지우는 줄의 설명을 옮겨 둔다
      var keep = firstRow[key];
      if (!cellStr_(tdata[keep][4]) && cellStr_(tdata[i][4])) {
        tdata[keep][4] = tdata[i][4];
        var dc = tsheet.getRange(keep + 1, 5);
        dc.setNumberFormat('@');
        dc.setValue(cellStr_(tdata[i][4]));
      }
      toDelete.push(i);
    }
    for (var x = toDelete.length - 1; x >= 0; x--) tsheet.deleteRow(toDelete[x] + 1);
    return jsonResponse_({ ok: true, changed: changed });
  } finally {
    lock.releaseLock();
  }
}

// 예전 보관함(archive)의 문제를 문제 은행으로 옮긴다 (한 번 옮긴 것은 다시 옮기지 않음).
// 예전 분류(학년 › 단원 › 세부 유형)는 유형과 문제틀에 같은 이름으로 들어가므로 나중에 유형표에서 다듬으면 된다.
function handleMigrateArchive_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var bankSheet = getTextSheet_('bank', BANK_HEADERS);
    var bank = bankSheet.getDataRange().getValues();
    var done = {};
    for (var i = 1; i < bank.length; i++) {
      var lid = cellStr_(bank[i][BANK_COL.legacy_archive_id]);
      if (lid) done[lid] = true;
    }
    var arch = getArchiveSheet_().getDataRange().getValues();
    var rows = [];
    var tax = [];
    var now = new Date().toISOString();
    var sets = 0;
    for (var j = 1; j < arch.length; j++) {
      var a = arch[j];
      var aid = cellStr_(a[ARCHIVE_COL.id]);
      if (!aid || done[aid]) continue;
      var g = cellStr_(a[ARCHIVE_COL.grade]), u = cellStr_(a[ARCHIVE_COL.unit]), s = cellStr_(a[ARCHIVE_COL.subtype]);
      var base = 'm' + aid;
      var originId = '';
      var src = cellStr_(a[ARCHIVE_COL.source_text]);
      if (src) {
        originId = base + '_0';
        rows.push([originId, now, g, u, s, s, '중', '원본', '', src, '', '', cellStr_(a[ARCHIVE_COL.image_file_id]), '', '', aid]);
      }
      if (cellStr_(a[ARCHIVE_COL.q1])) {
        rows.push([base + '_1', now, g, u, s, s, '중', 'AI 기본', originId, cellStr_(a[ARCHIVE_COL.q1]),
                   cellStr_(a[ARCHIVE_COL.a1]), cellStr_(a[ARCHIVE_COL.s1]), '', '', cellStr_(a[ARCHIVE_COL.memo]), aid]);
      }
      if (cellStr_(a[ARCHIVE_COL.q2])) {
        rows.push([base + '_2', now, g, u, s, s, '상', 'AI 실력', originId, cellStr_(a[ARCHIVE_COL.q2]),
                   cellStr_(a[ARCHIVE_COL.a2]), cellStr_(a[ARCHIVE_COL.s2]), '', '', cellStr_(a[ARCHIVE_COL.memo]), aid]);
      }
      tax.push({ grade: g, unit: u, type: s, frame: s });
      sets++;
    }
    appendTextRows_(bankSheet, rows);
    ensureTaxonomy_(tax);
    return jsonResponse_({ ok: true, sets: sets, problems: rows.length });
  } finally {
    lock.releaseLock();
  }
}
