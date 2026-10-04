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
 * 2. 스크립트 속성의 SECRET_TOKEN은 반드시 있어야 함 (Streamlit Secrets의 SHEET_API_TOKEN과 동일한 값).
 *    비어 있으면 보안을 위해 모든 요청을 거부한다.
 * 3. [배포] > [배포 관리] > 연필 아이콘 > 새 버전으로 재배포
 *    이번 버전은 구글 드라이브를 사용하므로, 재배포할 때 "드라이브 접근 권한"을 묻는 창이 뜨면 허용해 주세요.
 */

var PROBLEMS_HEADERS = ['id', 'class_id', 'date', 'image_b64', 'q1', 'a1', 's1', 'q2', 'a2', 's2'];
var STUDENTS_HEADERS = ['student_id', 'password_hash', 'class_id', 'created_at'];
var PERSONAL_HEADERS = ['id', 'student_id', 'class_id', 'source', 'origin_id', 'date', 'image_b64', 'q1', 'a1', 's1', 'q2', 'a2', 's2'];
// student_ids: 쉼표로 구분한 학생 아이디 목록 (예: "kim01,lee02")
// tags = 원본 문제의 구분, tags1/tags2 = 유사문제 1번/2번의 구분 (중요,틀림,어려워함 을 쉼표로, 여러 개 가능)
var ARCHIVE_HEADERS = ['id', 'date', 'student_ids', 'class_id', 'grade', 'unit', 'subtype', 'source_text', 'image_file_id', 'q1', 'a1', 's1', 'q2', 'a2', 's2', 'memo', 'created_at', 'tags', 'tags1', 'tags2', 'student_tags'];
// student_tags = 학생별 구분 JSON {"학생id": ["원본 구분", "1번 구분", "2번 구분"]}. 있으면 tags/tags1/tags2보다 먼저 쓴다.
var ARCHIVE_COL = {};
for (var _c = 0; _c < ARCHIVE_HEADERS.length; _c++) ARCHIVE_COL[ARCHIVE_HEADERS[_c]] = _c;

var ARCHIVE_FOLDER_NAME = '수학클래스룸_원본사진';

function getSecretToken_() {
  return PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN') || '';
}

// 토큰이 맞는지 확인한다. SECRET_TOKEN 속성이 비어 있으면 (설정을 빼먹은 경우) 모든 요청을 거부한다.
// 글자 하나씩 끝까지 비교해서 비교 시간으로 값을 추측하기 어렵게 한다.
function tokenOk_(given) {
  var secret = getSecretToken_();
  if (!secret) return false;
  given = String(given || '');
  var diff = secret.length ^ given.length;
  for (var i = 0; i < secret.length; i++) {
    diff |= secret.charCodeAt(i) ^ (i < given.length ? given.charCodeAt(i) : 0);
  }
  return diff === 0;
}

function authError_() {
  var msg = getSecretToken_() ? "unauthorized" : "token_not_configured";
  return jsonResponse_({ error: msg });
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ----- 동시에 여러 요청이 들어와도 시트가 꼬이지 않게 하는 잠금 도구 -----
function lockBusy_() {
  return jsonResponse_({ ok: false, error: "다른 작업이 진행 중입니다. 잠시 후 다시 해 주세요." });
}

// 잠금을 기다린다. 시간 안에 못 잡으면 예외 대신 false (앱에 깨진 응답이 가지 않게 한다)
function waitLockOk_(lock, ms) {
  try {
    lock.waitLock(ms);
    return true;
  } catch (err) {
    return false;
  }
}

// 읽고-고치고-쓰는 작업을 한 번에 한 요청씩만 하도록 잠금 안에서 실행한다
function locked_(fn) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 25000)) return lockBusy_();
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
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

// 기존 문제 게시판 시트: 처음 쓸 때의 "첫 번째 시트"를 기억해 두고 계속 그 시트를 쓴다.
// (탭 순서를 바꿔도 게시판 글이 문제 은행 같은 다른 탭에 섞여 들어가지 않게 하기 위함)
var NON_BOARD_SHEETS = ['students', 'personal_problems', 'archive', 'bank', 'taxonomy'];
function getProblemsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty('BOARD_SHEET_ID');
  var sheets = ss.getSheets();
  if (savedId) {
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === savedId) return sheets[i];
    }
  }
  for (var j = 0; j < sheets.length; j++) {
    if (NON_BOARD_SHEETS.indexOf(sheets[j].getName()) === -1) {
      props.setProperty('BOARD_SHEET_ID', String(sheets[j].getSheetId()));
      return sheets[j];
    }
  }
  return ss.getActiveSheet();
}

// ==========================================
// 진입점
// ==========================================
function doGet(e) {
  if (!tokenOk_(e.parameter && e.parameter.token)) {
    return authError_();
  }

  try {
    return routeGet_(e);
  } catch (err) {
    return jsonResponse_({ error: "server_error", detail: String(err) });
  }
}

function routeGet_(e) {
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
  if (action === 'star_list') return handleStarList_(e);
  if (action === 'star_items') return handleStarItems_(e);
  if (action === 'backup_info') return handleBackupInfo_();
  if (action === 'version') return jsonResponse_({ version: 9 });  // 3 = 숙제·채점·시험 점수, 4 = 학교 시험지 분석, 5 = 문제 구분, 6 = 학생별 구분·단원 학기, 7 = 은행 저장+학생 배정 한 번에, 8 = 백업, 9 = 사진만 올리기·지우기(문제는 Supabase에 저장하는 방식)
  if (action === 'hw_list') return handleHwList_(e);
  if (action === 'hw_results') return handleHwResults_(e);
  if (action === 'exam_list') return handleExamList_(e);
  if (action === 'unit_semesters') return handleUnitSemesters_();
  if (sheetParam === 'personal_problems') {
    return handleGetPersonal_(e);
  }
  return handleGetProblems_(e);
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ error: "invalid_json" });
  }
  if (!tokenOk_(body && body._token)) {
    return authError_();
  }

  try {
    return routePost_(body);
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function routePost_(body) {
  var action = body.action;
  if (action === 'signup') return locked_(function () { return handleSignup_(body); });
  if (action === 'login') return handleLogin_(body);
  if (action === 'assign_class') return locked_(function () { return handleAssignClass_(body); });
  if (action === 'withdraw') return handleWithdraw_(body);
  if (action === 'save_personal') return locked_(function () { return handleSavePersonal_(body); });
  if (action === 'delete_personal') return locked_(function () { return handleDeletePersonal_(body); });
  if (action === 'set_status') return handleSetStatus_(body);
  if (action === 'archive_save') return handleArchiveSave_(body);
  if (action === 'archive_delete') return handleArchiveDelete_(body);
  if (action === 'archive_update_students') return handleArchiveUpdateStudents_(body);
  if (action === 'archive_update_tags') return handleArchiveUpdateTags_(body);
  if (action === 'hw_tag') return handleHwTag_(body);
  if (action === 'unit_semester_set') return handleUnitSemesterSet_(body);
  if (action === 'bank_save') return handleBankSave_(body);
  if (action === 'save_assign') return handleSaveAssign_(body);
  if (action === 'backup_now') return handleBackupNow_();
  if (action === 'image_save') return handleImageSave_(body);
  if (action === 'image_trash') return handleImageTrash_(body);
  if (action === 'bank_update') return handleBankUpdate_(body);
  if (action === 'bank_delete') return handleBankDelete_(body);
  if (action === 'taxonomy_upsert') return handleTaxonomyUpsert_(body);
  if (action === 'taxonomy_rename') return handleTaxonomyRename_(body);
  if (action === 'migrate_archive') return handleMigrateArchive_();
  if (action === 'star_set') return handleStarSet_(body);
  if (action === 'hw_save') return handleHwSave_(body);
  if (action === 'hw_delete') return handleHwDelete_(body);
  if (action === 'hw_submit') return handleHwSubmit_(body);
  if (action === 'hw_mark') return handleHwMark_(body);
  if (action === 'exam_save') return handleExamSave_(body);
  if (action === 'exam_delete') return handleExamDelete_(body);
  if (action === 'exam_analysis') return handleExamAnalysis_(body);
  if (action === 'delete') return locked_(function () { return handleDeleteProblem_(body); });
  return locked_(function () { return handleInsertProblem_(body); }); // action 없으면 기존 게시판 등록(기본 동작)
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

// 이미 있는 탭만 가져온다 (탈퇴 처리 때문에 빈 탭이 새로 만들어지지 않게)
function existingSheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// 지정한 열(col, 1부터 시작)의 값이 value인 줄을 모두 지운다. 이어진 줄은 한 번에 지운다.
// 지운 줄 수를 돌려준다.
function deleteRowsWhere_(sheet, col, value) {
  if (!sheet) return 0;
  var vals = readCols_(sheet, col, 1);
  var removed = 0;
  var end = -1;  // 지울 덩어리의 끝(시트 줄 번호)
  for (var i = vals.length - 1; i >= -1; i--) {
    var hit = i >= 0 && String(vals[i][0]).trim() === value;
    if (hit && end < 0) end = i + 2;
    if (!hit && end >= 0) {
      var start = i + 3;
      sheet.deleteRows(start, end - start + 1);
      removed += end - start + 1;
      end = -1;
    }
  }
  return removed;
}

// 문제 보관함(archive): 문제는 그대로 두고, 대상 학생 목록과 학생별 구분에서만 그 학생을 뺀다.
function removeStudentFromArchive_(studentId) {
  var sheet = existingSheet_('archive');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  getArchiveSheet_();  // 예전 탭에 student_tags 머리글이 없으면 채워 둔다
  var n = sheet.getLastRow() - 1;
  var idRange = sheet.getRange(2, ARCHIVE_COL.student_ids + 1, n, 1);
  var tagRange = sheet.getRange(2, ARCHIVE_COL.student_tags + 1, n, 1);
  var idVals = idRange.getValues();
  var tagVals = tagRange.getValues();
  var changed = 0;
  for (var i = 0; i < n; i++) {
    var ids = splitIds_(idVals[i][0]);
    var at = ids.indexOf(studentId);
    if (at === -1) continue;
    ids.splice(at, 1);
    idVals[i][0] = ids.join(',');
    var raw = cellStr_(tagVals[i][0]);
    if (raw) {
      var obj = {};
      try { obj = JSON.parse(raw); } catch (err) { obj = {}; }
      if (obj && typeof obj === 'object') delete obj[studentId];
      tagVals[i][0] = cleanStudentTags_(obj);
    }
    changed++;
  }
  if (changed) {
    idRange.setNumberFormat('@');
    idRange.setValues(idVals.map(function (r) { return [safeCell_(r[0])]; }));
    tagRange.setNumberFormat('@');
    tagRange.setValues(tagVals.map(function (r) { return [safeCell_(r[0])]; }));
  }
  return changed;
}

// 숙제(homework): 여러 명에게 낸 숙제는 그 학생만 빼고, 그 학생에게만 낸 숙제는 지운다.
// (대상 학생이 비면 "반 전체 숙제"로 바뀌어 버리므로 남겨 두면 안 된다. 문제 자체는 문제 은행에 그대로 있다.)
function removeStudentFromHomework_(studentId) {
  var sheet = existingSheet_('homework');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var col = HW_HEADERS.indexOf('student_ids') + 1;
  var vals = readCols_(sheet, col, 1);
  var changed = 0;
  var drop = [];
  for (var i = 0; i < vals.length; i++) {
    var ids = splitIds_(vals[i][0]);
    var at = ids.indexOf(studentId);
    if (at === -1) continue;
    changed++;
    if (ids.length === 1) { drop.push(i + 2); continue; }
    ids.splice(at, 1);
    var cell = sheet.getRange(i + 2, col);
    cell.setNumberFormat('@');
    cell.setValue(safeCell_(ids.join(',')));
  }
  for (var d = drop.length - 1; d >= 0; d--) sheet.deleteRow(drop[d]);
  return changed;
}

// 회원 탈퇴: 학생의 계정과 학생 관련 기록(개인 보관함, 중요 표시, 숙제 결과, 시험 점수, 문제 배정)을 함께 지운다.
// 문제 은행과 선생님 보관함의 문제 자체는 지우지 않는다 (대상 학생에서만 빠진다).
// by_admin=true면 선생님이 강제 탈퇴시키는 것이므로 비밀번호 확인을 건너뛴다.
// by_admin이 없거나 false면 본인 탈퇴이므로 반드시 비밀번호가 일치해야 한다.
function handleWithdraw_(body) {
  var studentId = String(body.student_id || '').trim();
  if (!studentId) {
    return jsonResponse_({ ok: false, error: "student_id가 필요합니다." });
  }
  var byAdmin = !!body.by_admin;

  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 30000)) return lockBusy_();
  try {
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

    // 학생 기록부터 정리하고, 마지막에 계정을 지운다.
    // (중간에 실패하면 계정이 남아 있으니 다시 탈퇴를 눌러 이어서 처리할 수 있다)
    var summary = {
      personal: deleteRowsWhere_(existingSheet_('personal_problems'), 2, studentId),
      stars: deleteRowsWhere_(existingSheet_('stars'), 1, studentId),
      hw_results: deleteRowsWhere_(existingSheet_('hw_results'), 2, studentId),
      exams: deleteRowsWhere_(existingSheet_('exams'), 2, studentId),
      archive: removeStudentFromArchive_(studentId),
      homework: removeStudentFromHomework_(studentId)
    };
    studentsSheet.deleteRow(foundRow + 1);
    return jsonResponse_({ ok: true, removed: summary });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
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
  ensureHeaders_(sheet, ARCHIVE_HEADERS);
  return sheet;
}

// 예전에 만든 탭에 새로 생긴 머리글(맨 뒤 칸들)이 없으면 채워 둔다. 같은 실행 안에서는 한 번만 확인한다.
var headersChecked_ = {};
function ensureHeaders_(sheet, headers) {
  var name = sheet.getName();
  if (headersChecked_[name]) return;
  headersChecked_[name] = true;
  var cur = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var k = 0; k < headers.length; k++) {
    if (String(cur[k]) !== headers[k]) {
      sheet.getRange(1, k + 1).setNumberFormat('@').setValue(headers[k]);
    }
  }
}

// 구분 글자 정리: 정해진 세 가지만, 중복 없이, 정해진 순서로
var TAG_NAMES = ['중요', '틀림', '어려워함'];

// 학생별 구분 정리: {학생id: [원본, 1번, 2번]} 를 JSON 글자로. 잘못된 값은 버린다.
function cleanStudentTags_(v) {
  var obj = v;
  if (typeof v === 'string') {
    try { obj = v ? JSON.parse(v) : {}; } catch (err) { obj = {}; }
  }
  if (!obj || typeof obj !== 'object') return '';
  var out = {}, any = false;
  for (var sid in obj) {
    var arr = Array.isArray(obj[sid]) ? obj[sid] : [];
    var t = [cleanTags_(arr[0]), cleanTags_(arr[1]), cleanTags_(arr[2])];
    if (t[0] || t[1] || t[2]) { out[String(sid)] = t; any = true; }
  }
  return any ? JSON.stringify(out) : '';
}
function cleanTags_(v) {
  var parts = (Array.isArray(v) ? v : String(v || '').split(',')).map(function (x) { return String(x).trim(); });
  return TAG_NAMES.filter(function (t) { return parts.indexOf(t) !== -1; }).join(',');
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

// 2번째 줄부터 마지막 줄까지 firstCol부터 numCols개 열만 읽는다.
// 시트 전체(긴 문제·풀이 글 포함)를 읽지 않아서 문제가 많이 쌓여도 빠르다.
function readCols_(sheet, firstCol, numCols) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, firstCol, last - 1, numCols).getValues();
}

// 조건에 맞은 줄(시트 줄 번호 목록)만 전체 열을 읽어 온다. 최신순 순서를 유지한다.
function readRowsFull_(sheet, rowNums, numCols) {
  if (!rowNums.length) return [];
  var lo = Math.min.apply(null, rowNums), hi = Math.max.apply(null, rowNums);
  var block = sheet.getRange(lo, 1, hi - lo + 1, numCols).getValues();
  return rowNums.map(function (n) { return block[n - lo]; });
}

// 사진 파일을 문제 은행이나 예전 보관함의 다른 문제가 아직 쓰고 있는지 확인
function imageInUse_(fileId) {
  if (!fileId) return false;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var checks = [['bank', BANK_COL.image_file_id], ['archive', ARCHIVE_COL.image_file_id]];
  for (var c = 0; c < checks.length; c++) {
    var sh = ss.getSheetByName(checks[c][0]);
    if (!sh) continue;
    var col = readCols_(sh, checks[c][1] + 1, 1);
    for (var i = 0; i < col.length; i++) {
      if (cellStr_(col[i][0]) === fileId) return true;
    }
  }
  return false;
}

function trashImageIfUnused_(fileId) {
  if (!fileId || imageInUse_(fileId)) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { /* 이미 없는 파일 */ }
}

// id 열만 읽어서 그 문제의 시트 줄 번호를 찾는다 (없으면 -1)
function findRowById_(sheet, idCol, id) {
  var ids = readCols_(sheet, idCol + 1, 1);
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
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

// 사진(base64)을 드라이브 보관함 폴더에 파일로 올리고 파일 id를 돌려준다
function saveImageFile_(b64, name) {
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name);
  return getArchiveFolder_().createFile(blob).getId();
}

function trashFile_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { /* 이미 없는 파일 */ }
}

// 이미 같은 id의 보관 문제가 있으면 true (같은 요청이 다시 와도 중복 저장하지 않기 위함)
function archiveExists_(id) {
  return !!id && findRowById_(getArchiveSheet_(), ARCHIVE_COL.id, id) > 0;
}

// 보관함에 한 줄 추가. 잠금 안에서만 부른다.
function archiveAppend_(body, fileId) {
  var studentIds = splitIds_(body.student_ids).join(',');
  var row = [
    body.id, body.date, studentIds, body.class_id, body.grade, body.unit, body.subtype,
    body.source_text, fileId, body.q1, body.a1, body.s1, body.q2, body.a2, body.s2,
    body.memo, new Date().toISOString(), cleanTags_(body.tags), cleanTags_(body.tags1), cleanTags_(body.tags2),
    cleanStudentTags_(body.student_tags)
  ].map(safeCell_);
  // appendRow 대신 서식을 먼저 "일반 텍스트"로 지정한 뒤 값을 넣는다 (1000행을 넘어가도 날짜/아이디가 변형되지 않게)
  var sheet = getArchiveSheet_();
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length);
  range.setNumberFormat('@');
  range.setValues([row]);
}

function handleArchiveSave_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  var fileId = '';
  try {
    if (archiveExists_(body.id)) return jsonResponse_({ ok: true, duplicate: true });
    if (body.image_b64) fileId = saveImageFile_(body.image_b64, 'archive_' + body.id + '.jpg');
    archiveAppend_(body, fileId);
    return jsonResponse_({ ok: true, image_file_id: fileId });
  } catch (err) {
    trashFile_(fileId);
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function handleArchiveDelete_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getArchiveSheet_();
    var row = findRowById_(sheet, ARCHIVE_COL.id, body.id);
    if (row < 0) return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
    var fileId = cellStr_(sheet.getRange(row, ARCHIVE_COL.image_file_id + 1).getValue());
    sheet.deleteRow(row);
    // 문제 은행으로 옮긴 문제가 같은 사진을 쓰고 있으면 사진은 남긴다
    trashImageIfUnused_(fileId);
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 이미 보관한 문제에 대상 학생을 바꾸거나 추가할 때
function handleArchiveUpdateStudents_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getArchiveSheet_();
    var row = findRowById_(sheet, ARCHIVE_COL.id, body.id);
    if (row < 0) return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
    sheet.getRange(row, ARCHIVE_COL.student_ids + 1).setValue(splitIds_(body.student_ids).join(','));
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 원본 문제 / 유사문제 1번 / 2번의 구분(중요·틀림·어려워함)을 바꾼다
function handleArchiveUpdateTags_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getArchiveSheet_();
    var row = findRowById_(sheet, ARCHIVE_COL.id, body.id);
    if (row < 0) return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
    if (body.student_tags !== undefined) {
      sheet.getRange(row, ARCHIVE_COL.student_tags + 1).setNumberFormat('@').setValue(cleanStudentTags_(body.student_tags));
    } else {
      var rg = sheet.getRange(row, ARCHIVE_COL.tags + 1, 1, 3);
      rg.setNumberFormat('@');
      rg.setValues([[cleanTags_(body.tags), cleanTags_(body.tags1), cleanTags_(body.tags2)]]);
    }
    return jsonResponse_({ ok: true });
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
  var idSet = null;
  if (p.ids) { idSet = {}; String(p.ids).split(',').forEach(function (x) { if (x.trim()) idSet[x.trim()] = true; }); }

  // 짧은 열(id~세부 유형)만 먼저 읽어 거르고, 이번 쪽에 보여줄 줄만 전체를 읽는다
  var sheet = getArchiveSheet_();
  var meta = keyword ? readCols_(sheet, 1, ARCHIVE_HEADERS.length) : readCols_(sheet, 1, ARCHIVE_COL.subtype + 1);
  var pageRows = [];
  var total = 0;
  for (var i = meta.length - 1; i >= 0; i--) {
    var r = meta[i];
    if (!r[ARCHIVE_COL.id]) continue;
    if (idSet && !idSet[cellStr_(r[ARCHIVE_COL.id])]) continue;
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
    if (total >= offset && pageRows.length < limit) pageRows.push(i + 2);
    total++;
  }
  var items = readRowsFull_(sheet, pageRows, ARCHIVE_HEADERS.length).map(function (r) { return archiveRowToObj_(r, true); });
  return jsonResponse_({ items: items, total: total });
}

// 지금까지 쓰인 유형 목록 (학년 › 단원 › 세부 유형) 과 각 개수
function handleArchiveTypes_() {
  var data = readCols_(getArchiveSheet_(), 1, ARCHIVE_COL.subtype + 1);
  var seen = {};
  var list = [];
  for (var i = 0; i < data.length; i++) {
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

  var data = readCols_(getArchiveSheet_(), 1, ARCHIVE_COL.subtype + 1);
  var counts = {};
  var rows = [];
  for (var i = 0; i < data.length; i++) {
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
// 사진만 드라이브 보관함 폴더에 올린다 (문제 글은 Supabase에 저장하고 사진만 드라이브에 두는 방식에서 쓴다).
function handleImageSave_(body) {
  if (!body.image_b64) return jsonResponse_({ ok: false, error: "image_b64가 필요합니다." });
  try {
    var name = 'img_' + String(body.name || new Date().getTime()).replace(/[^A-Za-z0-9_-]/g, '') + '.jpg';
    return jsonResponse_({ ok: true, file_id: saveImageFile_(body.image_b64, name) });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

// 보관함 폴더에 있는 사진만, 시트(예전 방식)에서 쓰고 있지 않을 때 휴지통으로 보낸다.
// (Supabase 쪽에서 쓰고 있는지는 앱이 확인한 뒤에 요청한다)
function handleImageTrash_(body) {
  var fileId = String(body.file_id || '');
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
    trashImageIfUnused_(fileId);
    return jsonResponse_({ ok: true });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

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
// 문제 은행에 넣을 문제들의 id 목록 (group_id + 순번). 같은 group_id면 항상 같은 id가 나온다.
function bankIdsFor_(body) {
  var base = String(body.group_id || new Date().getTime());
  return (body.problems || []).map(function (p, i) { return base + '_' + (i + 1); });
}

// 이미 같은 group_id로 저장된 적이 있으면 true (같은 요청이 다시 와도 중복 저장하지 않기 위함)
function bankExists_(body) {
  if (!body.group_id) return false;
  return findRowById_(getTextSheet_('bank', BANK_HEADERS), BANK_COL.id, String(body.group_id) + '_1') > 0;
}

// 문제 은행에 여러 줄 추가. 잠금 안에서만 부른다. 새로 쓴 줄 위치를 돌려줘서 실패하면 되돌릴 수 있게 한다.
function bankAppend_(body, fileId) {
  var problems = body.problems || [];
  var now = new Date().toISOString();
  var ids = bankIdsFor_(body);
  var rows = [];
  var originId = '';
  for (var i = 0; i < problems.length; i++) {
    var p = problems[i];
    var id = ids[i];
    if (p.source === '원본') originId = id;
    rows.push([id, now, p.grade, p.unit, p.type, p.frame, p.difficulty, p.source,
               p.source === '원본' ? '' : originId, p.question, p.answer, p.solution,
               p.use_image ? fileId : '', p.verified ? 'Y' : '', p.memo, '']);
  }
  var sheet = getTextSheet_('bank', BANK_HEADERS);
  var startRow = sheet.getLastRow() + 1;
  appendTextRows_(sheet, rows);
  ensureTaxonomy_(problems.map(function (p) {
    return { grade: p.grade, unit: p.unit, type: p.type, frame: p.frame, description: p.frame_description };
  }));
  return { ids: ids, startRow: startRow, count: rows.length };
}

function bankNeedsImage_(body) {
  return (body.problems || []).some(function (p) { return p.use_image; });
}

// 여러 문제를 한 번에 저장. body.problems = [{grade, unit, type, frame, frame_description, difficulty, source,
//   question, answer, solution, verified, memo, use_image}], body.image_b64 = 원본 사진(선택)
function handleBankSave_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  var fileId = '';
  try {
    var problems = body.problems || [];
    if (!problems.length) return jsonResponse_({ ok: false, error: "저장할 문제가 없습니다." });
    if (bankExists_(body)) return jsonResponse_({ ok: true, ids: bankIdsFor_(body), duplicate: true });
    if (body.image_b64) fileId = saveImageFile_(body.image_b64, 'bank_' + body.group_id + '.jpg');
    var res = bankAppend_(body, fileId);
    return jsonResponse_({ ok: true, ids: res.ids, image_file_id: fileId });
  } catch (err) {
    trashFile_(fileId);
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 문제 은행 저장 + 학생 배정을 한 번에 처리한다 (한쪽만 저장되고 끊기는 일이 없게).
// body = { bank: {group_id, problems:[...]} 또는 없음, archive: {id, date, student_ids, ...} 또는 없음, image_b64 }
// 같은 group_id / id로 다시 요청이 와도(두 번 클릭, 재시도) 이미 저장된 쪽은 건너뛰고 중복을 만들지 않는다.
// 중간에 실패하면 이번 요청에서 쓴 은행 줄과 사진 파일을 되돌린다.
function handleSaveAssign_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 25000)) return lockBusy_();
  var fileId = '';
  var bankRes = null;
  var bankSheet = null;
  try {
    var bank = body.bank && (body.bank.problems || []).length ? body.bank : null;
    var arch = body.archive || null;
    if (!bank && !arch) return jsonResponse_({ ok: false, error: "저장할 내용이 없습니다." });
    var needBank = !!bank && !bankExists_(bank);
    var needArch = !!arch && !archiveExists_(arch.id);
    if (needBank || needArch) {
      var needImage = (needBank && bankNeedsImage_(bank)) || needArch;
      if (body.image_b64 && needImage) {
        fileId = saveImageFile_(body.image_b64, 'save_' + (bank ? bank.group_id : arch.id) + '.jpg');
      }
      if (needBank) {
        bankSheet = getTextSheet_('bank', BANK_HEADERS);
        bankRes = bankAppend_(bank, fileId);
      }
      if (needArch) archiveAppend_(arch, fileId);
    }
    return jsonResponse_({
      ok: true,
      ids: bank ? bankIdsFor_(bank) : [],
      image_file_id: fileId,
      bank_saved: needBank,
      archive_saved: needArch,
      duplicate: !(needBank || needArch)
    });
  } catch (err) {
    // 이번 요청에서 쓴 것만 되돌린다. 되돌리기에 실패하면 은행 줄이 사진을 가리키고 있으므로 사진은 남긴다.
    var undone = true;
    try {
      if (bankRes && bankSheet && bankSheet.getLastRow() >= bankRes.startRow + bankRes.count - 1) {
        bankSheet.deleteRows(bankRes.startRow, bankRes.count);
      }
    } catch (e2) {
      undone = false;
    }
    if (undone) trashFile_(fileId);
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 한 문제의 일부 칸만 고친다 (body.fields = {question: ..., verified: 'Y', ...})
function handleBankUpdate_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getTextSheet_('bank', BANK_HEADERS);
    var editable = ['grade', 'unit', 'type', 'frame', 'difficulty', 'question', 'answer', 'solution', 'verified', 'memo'];
    var row = findRowById_(sheet, BANK_COL.id, body.id);
    if (row < 0) return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
    var fields = body.fields || {};
    for (var k = 0; k < editable.length; k++) {
      var f = editable[k];
      if (fields.hasOwnProperty(f)) {
        var cell = sheet.getRange(row, BANK_COL[f] + 1);
        cell.setNumberFormat('@');
        cell.setValue(safeCell_(fields[f]));
      }
    }
    if (fields.frame) {
      // 문제틀만 바꿔도 유형표에 빈 학년·단원이 생기지 않도록 시트에 저장된 값을 읽어서 쓴다
      var cls = sheet.getRange(row, BANK_COL.grade + 1, 1, 4).getValues()[0];
      ensureTaxonomy_([{ grade: cellStr_(cls[0]), unit: cellStr_(cls[1]), type: cellStr_(cls[2]), frame: cellStr_(cls[3]) }]);
    }
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function handleBankDelete_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getTextSheet_('bank', BANK_HEADERS);
    var row = findRowById_(sheet, BANK_COL.id, body.id);
    if (row < 0) return jsonResponse_({ ok: false, error: "문제를 찾을 수 없습니다." });
    var fileId = cellStr_(sheet.getRange(row, BANK_COL.image_file_id + 1).getValue());
    sheet.deleteRow(row);
    // 같은 사진을 쓰는 다른 문제(문제 은행·예전 보관함)가 없을 때만 사진도 휴지통으로
    trashImageIfUnused_(fileId);
    return jsonResponse_({ ok: true });
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

  // 긴 글(문제·정답·풀이)은 빼고 분류 열과 검수 열만 먼저 읽어 거른 뒤, 이번 쪽에 보여줄 줄만 전체를 읽는다.
  // 키워드 검색일 때만 문제 글 열을 함께 읽는다.
  var sheet = getTextSheet_('bank', BANK_HEADERS);
  var data = keyword ? readCols_(sheet, 1, BANK_HEADERS.length) : null;
  var meta = data || readCols_(sheet, 1, BANK_COL.origin_id + 1);
  var verCol = data ? null : readCols_(sheet, BANK_COL.verified + 1, 1);
  var pageRows = [];
  var total = 0;
  for (var i = meta.length - 1; i >= 0; i--) {
    var r = meta[i];
    if (!r[BANK_COL.id]) continue;
    if (idSet && !idSet[cellStr_(r[BANK_COL.id])]) continue;
    var skip = false;
    for (var f in exact) { if (cellStr_(r[BANK_COL[f]]) !== exact[f]) { skip = true; break; } }
    if (skip) continue;
    if (diffs && diffs.indexOf(cellStr_(r[BANK_COL.difficulty])) === -1) continue;
    var ver = data ? r[BANK_COL.verified] : verCol[i][0];
    if (verifiedOnly && cellStr_(ver) !== 'Y') continue;
    if (keyword) {
      var hay = (cellStr_(r[BANK_COL.question]) + ' ' + cellStr_(r[BANK_COL.memo]) + ' ' + cellStr_(r[BANK_COL.frame])).toLowerCase();
      if (hay.indexOf(keyword) === -1) continue;
    }
    if (total >= offset && pageRows.length < limit) pageRows.push(i + 2);
    total++;
  }
  var items = readRowsFull_(sheet, pageRows, BANK_HEADERS.length).map(bankRowToObj_);
  return jsonResponse_({ items: items, total: total });
}

// 유형표 + 문제틀마다 문제 수 / 검수 완료 수 / 난이도별 수
function handleTaxonomy_() {
  var tax = getTextSheet_('taxonomy', TAXONOMY_HEADERS).getDataRange().getValues();
  // 문제 수를 셀 때는 분류·난이도 열과 검수 열만 읽는다
  var bankSheet = getTextSheet_('bank', BANK_HEADERS);
  var bank = readCols_(bankSheet, 1, BANK_COL.difficulty + 1);
  var bankVer = readCols_(bankSheet, BANK_COL.verified + 1, 1);
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
  for (var j = 0; j < bank.length; j++) {
    var r = bank[j];
    if (!r[BANK_COL.id]) continue;
    var en = entry(cellStr_(r[BANK_COL.grade]), cellStr_(r[BANK_COL.unit]), cellStr_(r[BANK_COL.type]), cellStr_(r[BANK_COL.frame]), '');
    en.count++;
    if (cellStr_(bankVer[j][0]) === 'Y') en.verified++;
    var d = cellStr_(r[BANK_COL.difficulty]);
    if (en.hasOwnProperty(d)) en[d]++;
  }
  return jsonResponse_(list);
}

// 문제틀 설명 추가/수정 (없으면 새로 만든다)
function handleTaxonomyUpsert_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
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
  if (!waitLockOk_(lock, 30000)) return lockBusy_();
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
  if (!waitLockOk_(lock, 30000)) return lockBusy_();
  try {
    var bankSheet = getTextSheet_('bank', BANK_HEADERS);
    var bank = readCols_(bankSheet, BANK_COL.legacy_archive_id + 1, 1);
    var done = {};
    for (var i = 0; i < bank.length; i++) {
      var lid = cellStr_(bank[i][0]);
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

// ==========================================
// ★ 학생 중요 문제함 (stars 탭)
// 학생이 받은 문제 중 따로 모아 보고 싶은 문제를 체크해 둔다.
// item_key = "보관함 문제 id|1" (1번 문제) 또는 "보관함 문제 id|2" (2번 문제)
// ==========================================
var STAR_HEADERS = ['student_id', 'item_key', 'archive_id', 'created_at'];

function handleStarList_(e) {
  var student = (e.parameter && e.parameter.student_id) ? String(e.parameter.student_id) : '';
  if (!student) return jsonResponse_([]);
  var data = readCols_(getTextSheet_('stars', STAR_HEADERS), 1, 2);
  var keys = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === student) keys.push(cellStr_(data[i][1]));
  }
  return jsonResponse_(keys);
}

function handleStarSet_(body) {
  var student = String(body.student_id || '');
  var key = String(body.item_key || '');
  if (!student || !key) return jsonResponse_({ ok: false, error: "student_id와 item_key가 필요합니다." });
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getTextSheet_('stars', STAR_HEADERS);
    var data = readCols_(sheet, 1, 2);
    var found = -1;
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]) === student && cellStr_(data[i][1]) === key) { found = i + 2; break; }
    }
    if (body.on && found < 0) {
      appendTextRows_(sheet, [[student, key, key.split('|')[0], new Date().toISOString()]]);
    } else if (!body.on && found > 0) {
      sheet.deleteRow(found);
    }
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 학생이 체크한 문제가 들어 있는 보관함 문제들 (그 학생에게 배정된 것만, 최근에 체크한 순서)
function handleStarItems_(e) {
  var student = (e.parameter && e.parameter.student_id) ? String(e.parameter.student_id) : '';
  if (!student) return jsonResponse_({ items: [], keys: [] });
  var stars = readCols_(getTextSheet_('stars', STAR_HEADERS), 1, 3);
  var keys = [], order = [], seen = {};
  for (var i = stars.length - 1; i >= 0; i--) {
    if (String(stars[i][0]) !== student) continue;
    keys.push(cellStr_(stars[i][1]));
    var aid = cellStr_(stars[i][2]);
    if (!seen[aid]) { seen[aid] = true; order.push(aid); }
  }
  if (!order.length) return jsonResponse_({ items: [], keys: [] });
  var sheet = getArchiveSheet_();
  var meta = readCols_(sheet, 1, ARCHIVE_COL.student_ids + 1);
  var rowOf = {};
  for (var j = 0; j < meta.length; j++) {
    var id = cellStr_(meta[j][ARCHIVE_COL.id]);
    if (seen[id] && splitIds_(meta[j][ARCHIVE_COL.student_ids]).indexOf(student) !== -1) rowOf[id] = j + 2;
  }
  var rows = order.filter(function (id) { return rowOf[id]; }).slice(0, 300).map(function (id) { return rowOf[id]; });
  var items = readRowsFull_(sheet, rows, ARCHIVE_HEADERS.length).map(function (r) { return archiveRowToObj_(r, false); });
  return jsonResponse_({ items: items, keys: keys });
}

// ==========================================
// ★ 숙제 (homework 탭) + 채점 결과 (hw_results 탭) + 시험 점수 (exams 탭)
// 숙제는 문제를 복사하지 않고 문제 은행(bank)의 문제 id 목록만 저장한다.
// 채점 결과는 학생 · 숙제 · 문제 id · 낸 답 · 정답 여부(Y/N/?)만 남기고,
// 단원·유형은 리포트를 만들 때 문제 은행에서 붙여 계산한다.
// ==========================================
var HW_HEADERS = ['hw_id', 'created_at', 'title', 'due_date', 'class_id', 'student_ids', 'problem_ids', 'memo'];
var HWR_HEADERS = ['hw_id', 'student_id', 'problem_id', 'answer', 'correct', 'graded_by', 'updated_at', 'tags'];

// hw_results 탭 (예전에 만든 탭에는 'tags' 머리글이 없으므로 채워 둔다)
function getHwrSheet_() {
  var sheet = getTextSheet_('hw_results', HWR_HEADERS);
  ensureHeaders_(sheet, HWR_HEADERS);
  return sheet;
}
var EXAM_HEADERS = ['id', 'student_id', 'date', 'kind', 'name', 'score', 'max_score', 'memo', 'created_at', 'analysis'];

// exams 탭 (예전에 만든 탭에는 'analysis' 머리글이 없으므로 채워 둔다)
function getExamSheet_() {
  var sheet = getTextSheet_('exams', EXAM_HEADERS);
  var col = EXAM_HEADERS.length;
  if (String(sheet.getRange(1, col).getValue()) !== EXAM_HEADERS[col - 1]) {
    sheet.getRange(1, col).setNumberFormat('@').setValue(EXAM_HEADERS[col - 1]);
  }
  return sheet;
}

function rowsToObjs_(rows, headers) {
  return rows.map(function (r) {
    var o = {};
    for (var k = 0; k < headers.length; k++) o[headers[k]] = cellStr_(r[k]);
    return o;
  });
}

// 숙제 목록 (최신순). student_id를 주면 그 학생이 받은 숙제만:
// 대상 학생에 이름이 있거나, 대상 학생이 비어 있고 반이 같은 숙제.
function handleHwList_(e) {
  var p = e.parameter || {};
  var student = p.student_id ? String(p.student_id) : '';
  var classId = p.class_id ? String(p.class_id) : '';
  var limit = Math.min(parseInt(p.limit || '100', 10) || 100, 500);
  var rows = readCols_(getTextSheet_('homework', HW_HEADERS), 1, HW_HEADERS.length);
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    var r = rows[i];
    if (!r[0]) continue;
    var ids = splitIds_(r[5]);
    var cls = cellStr_(r[4]);
    if (student) {
      var mine = ids.length ? ids.indexOf(student) !== -1 : (classId && cls === classId);
      if (!mine) continue;
    } else if (classId && cls !== classId) {
      continue;
    }
    out.push(rowsToObjs_([r], HW_HEADERS)[0]);
  }
  return jsonResponse_(out);
}

function handleHwSave_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var pids = (body.problem_ids || []).map(String).filter(function (x) { return x; });
    if (!pids.length) return jsonResponse_({ ok: false, error: "숙제에 넣을 문제가 없습니다." });
    var id = 'hw' + new Date().getTime();
    appendTextRows_(getTextSheet_('homework', HW_HEADERS), [[
      id, new Date().toISOString(), body.title || '숙제', body.due_date || '', body.class_id || '',
      splitIds_(Array.isArray(body.student_ids) ? body.student_ids.join(',') : (body.student_ids || '')).join(','),
      pids.join(','), body.memo || ''
    ]]);
    return jsonResponse_({ ok: true, hw_id: id });
  } finally {
    lock.releaseLock();
  }
}

function handleHwDelete_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getTextSheet_('homework', HW_HEADERS);
    var row = findRowById_(sheet, 0, body.hw_id);
    if (row < 0) return jsonResponse_({ ok: false, error: "숙제를 찾을 수 없습니다." });
    sheet.deleteRow(row);
    var rs = getHwrSheet_();
    var ids = readCols_(rs, 1, 1);
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === String(body.hw_id)) rs.deleteRow(i + 2);
    }
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 채점 결과. hw_id, student_id 로 좁힐 수 있다.
function handleHwResults_(e) {
  var p = e.parameter || {};
  var hw = p.hw_id ? String(p.hw_id) : '';
  var student = p.student_id ? String(p.student_id) : '';
  var rows = readCols_(getHwrSheet_(), 1, HWR_HEADERS.length);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (hw && String(r[0]) !== hw) continue;
    if (student && String(r[1]) !== student) continue;
    out.push(rowsToObjs_([r], HWR_HEADERS)[0]);
  }
  return jsonResponse_(out);
}

// 결과 한 줄을 넣거나 고친다 (같은 숙제·학생·문제가 있으면 덮어씀).
// answer / correct / tags 중 보내지 않은 칸(undefined)은 예전 값을 그대로 둔다.
function upsertResults_(hwId, studentId, items, gradedBy) {
  var sheet = getHwrSheet_();
  var rows = readCols_(sheet, 1, 3);
  var where = {};
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === hwId && String(rows[i][1]) === studentId) where[String(rows[i][2])] = i + 2;
  }
  var now = new Date().toISOString();
  var add = [];
  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    var pid = String(it.problem_id || '');
    if (!pid) continue;
    var answer = it.answer === undefined || it.answer === null ? null : String(it.answer);
    var correct = it.correct === undefined || it.correct === null ? null : String(it.correct);
    var tags = it.tags === undefined || it.tags === null ? null : cleanTags_(it.tags);
    if (where[pid]) {
      var rg = sheet.getRange(where[pid], 1, 1, HWR_HEADERS.length);
      var old = rg.getValues()[0];
      var vals = [hwId, studentId, pid,
                  answer === null ? cellStr_(old[3]) : answer,   // 선생님이 O/X만 고칠 때는 학생 답을 그대로 둔다
                  correct === null ? cellStr_(old[4]) : correct,
                  correct === null ? cellStr_(old[5]) : gradedBy,
                  now,
                  tags === null ? cellStr_(old[7]) : tags];
      rg.setNumberFormat('@');
      rg.setValues([vals.map(safeCell_)]);
    } else {
      add.push([hwId, studentId, pid, answer || '', correct || '', correct === null ? '' : gradedBy, now, tags || '']);
    }
  }
  appendTextRows_(sheet, add);
}

// 학생 제출: body.answers = [{problem_id, answer, correct}] (채점은 앱에서 해서 보낸다)
function handleHwSubmit_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    upsertResults_(String(body.hw_id || ''), String(body.student_id || ''), body.answers || [], 'auto');
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 선생님이 O/X를 직접 넣거나 고칠 때: body.marks = [{problem_id, correct}]
function handleHwMark_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    upsertResults_(String(body.hw_id || ''), String(body.student_id || ''), body.marks || [], 'teacher');
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function handleExamList_(e) {
  var student = (e.parameter && e.parameter.student_id) ? String(e.parameter.student_id) : '';
  var rows = readCols_(getExamSheet_(), 1, EXAM_HEADERS.length);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    if (student && String(rows[i][1]) !== student) continue;
    out.push(rowsToObjs_([rows[i]], EXAM_HEADERS)[0]);
  }
  return jsonResponse_(out);
}

function handleExamSave_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var id = 'ex' + new Date().getTime();
    appendTextRows_(getExamSheet_(), [[
      id, body.student_id || '', body.date || '', body.kind || '', body.name || '',
      String(body.score === undefined ? '' : body.score), String(body.max_score === undefined ? '' : body.max_score),
      body.memo || '', new Date().toISOString(), ''
    ]]);
    return jsonResponse_({ ok: true, id: id });
  } finally {
    lock.releaseLock();
  }
}

function handleExamDelete_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getExamSheet_();
    var row = findRowById_(sheet, 0, body.id);
    if (row < 0) return jsonResponse_({ ok: false, error: "시험 기록을 찾을 수 없습니다." });
    sheet.deleteRow(row);
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 학교 시험지 분석 결과(JSON 글자)를 그 시험 기록에 저장한다. 셀 한 칸 한도(5만 자) 안으로 자른다.
function handleExamAnalysis_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var sheet = getExamSheet_();
    var row = findRowById_(sheet, 0, body.id);
    if (row < 0) return jsonResponse_({ ok: false, error: "시험 기록을 찾을 수 없습니다." });
    var text = String(body.analysis || '').slice(0, 45000);
    sheet.getRange(row, EXAM_HEADERS.length).setNumberFormat('@').setValue(safeCell_(text));
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// 선생님이 숙제 문제에 구분(어려워함·중요)을 체크할 때: body.tags = [{problem_id, tags}]
function handleHwTag_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var items = (body.tags || []).map(function (t) { return { problem_id: t.problem_id, tags: t.tags || '' }; });
    upsertResults_(String(body.hw_id || ''), String(body.student_id || ''), items, 'teacher');
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// ★ 백업: 스프레드시트 전체를 드라이브 폴더에 날짜 이름으로 복사해 둔다
// - 매주 자동(setupWeeklyBackup을 편집기에서 한 번 실행) + 선생님 화면의 '지금 백업' 버튼
// - 가장 최근 BACKUP_KEEP개만 남기고 오래된 것은 휴지통으로 보낸다
// - 문제 원본 사진은 드라이브 '수학클래스룸_원본사진' 폴더에 따로 있어서 이 백업에는 들어가지 않는다
// ==========================================
var BACKUP_FOLDER_NAME = '수학클래스룸_백업';
var BACKUP_PREFIX = '백업_';
var BACKUP_KEEP = 8;

function getBackupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('BACKUP_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      // 폴더가 지워졌으면 아래에서 새로 만든다
    }
  }
  var folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

// 백업 폴더에서 BACKUP_KEEP개를 넘는 오래된 백업을 휴지통으로 보낸다. 지운 개수를 돌려준다.
function pruneBackups_(folder) {
  var list = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0) list.push({ file: f, at: f.getDateCreated().getTime() });
  }
  list.sort(function (a, b) { return b.at - a.at; });
  var removed = 0;
  for (var i = BACKUP_KEEP; i < list.length; i++) {
    list[i].file.setTrashed(true);
    removed++;
  }
  return removed;
}

// 지금 스프레드시트를 복사해 둔다. kind = 'auto' | 'manual'. 잠금 안에서만 부른다.
function runBackup_(kind) {
  var props = PropertiesService.getScriptProperties();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var folder = getBackupFolder_();
    var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd_HHmm');
    var name = BACKUP_PREFIX + ss.getName() + '_' + stamp;
    DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
    pruneBackups_(folder);
    props.setProperty('LAST_BACKUP_AT', new Date().toISOString());
    props.setProperty('LAST_BACKUP_NAME', name);
    props.setProperty('LAST_BACKUP_KIND', kind);
    props.deleteProperty('LAST_BACKUP_ERROR');
    return { ok: true, name: name, kind: kind };
  } catch (err) {
    props.setProperty('LAST_BACKUP_ERROR', new Date().toISOString() + ' ' + String(err));
    return { ok: false, error: String(err) };
  }
}

// 시간 트리거가 부르는 함수 (매주 자동 백업)
function weeklyBackup() {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 30000)) {
    PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_ERROR', new Date().toISOString() + ' 다른 작업 때문에 백업을 하지 못했습니다');
    return;
  }
  try {
    runBackup_('auto');
  } finally {
    lock.releaseLock();
  }
}

// ★ 편집기에서 한 번만 실행하면 매주 일요일 새벽 3시(스크립트 시간대)에 자동 백업이 켜진다.
// 여러 번 실행해도 트리거는 하나만 남는다. (처음 실행할 때 권한 허용 창이 뜬다)
function setupWeeklyBackup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'weeklyBackup') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  PropertiesService.getScriptProperties().setProperty('AUTO_BACKUP', 'on');
}

// 자동 백업을 끄고 싶을 때 편집기에서 실행
function removeWeeklyBackup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'weeklyBackup') ScriptApp.deleteTrigger(triggers[i]);
  }
  PropertiesService.getScriptProperties().deleteProperty('AUTO_BACKUP');
}

function handleBackupNow_() {
  return locked_(function () { return jsonResponse_(runBackup_('manual')); });
}

function handleBackupInfo_() {
  var p = PropertiesService.getScriptProperties();
  return jsonResponse_({
    last_at: p.getProperty('LAST_BACKUP_AT') || '',
    last_name: p.getProperty('LAST_BACKUP_NAME') || '',
    last_kind: p.getProperty('LAST_BACKUP_KIND') || '',
    last_error: p.getProperty('LAST_BACKUP_ERROR') || '',
    auto: p.getProperty('AUTO_BACKUP') === 'on',
    keep: BACKUP_KEEP
  });
}

// ==========================================
// ★ 단원별 학기 (units 탭): 학년 · 단원 → 1학기 / 2학기
// ==========================================
var UNIT_HEADERS = ['grade', 'unit', 'semester', 'updated_at'];

function handleUnitSemesters_() {
  var rows = readCols_(getTextSheet_('units', UNIT_HEADERS), 1, UNIT_HEADERS.length);
  return jsonResponse_(rows.filter(function (r) { return r[1]; }).map(function (r) { return rowsToObjs_([r], UNIT_HEADERS)[0]; }));
}

function handleUnitSemesterSet_(body) {
  var lock = LockService.getScriptLock();
  if (!waitLockOk_(lock, 20000)) return lockBusy_();
  try {
    var grade = String(body.grade || ''), unit = String(body.unit || ''), sem = String(body.semester || '');
    if (!unit) return jsonResponse_({ ok: false, error: "단원이 필요합니다." });
    var sheet = getTextSheet_('units', UNIT_HEADERS);
    var rows = readCols_(sheet, 1, 2);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === grade && String(rows[i][1]) === unit) {
        var rg = sheet.getRange(i + 2, 3, 1, 2);
        rg.setNumberFormat('@');
        rg.setValues([[sem, new Date().toISOString()]]);
        return jsonResponse_({ ok: true });
      }
    }
    appendTextRows_(sheet, [[grade, unit, sem, new Date().toISOString()]]);
    return jsonResponse_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}
