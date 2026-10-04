import streamlit as st
import requests
import json
import base64
import re
import html
from fractions import Fraction
import os
import time
import datetime
import io
import hashlib
import hmac
import logging
import ast
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from google import genai

import dbconn

# 페이지 기본 설정
st.set_page_config(page_title="수학 유사 문제 클래스룸", layout="centered")

st.title("📐 AI 수학 온라인 클래스룸")

# ==========================================
# ★ 구글 스프레드시트 연동 DB 함수
# ==========================================
sheet_url = st.secrets.get("GOOGLE_SHEET_URL", "").strip()

# ★ 보안 수정: Apps Script와 서로 확인하는 '비밀 토큰'.
# 이 값은 st.secrets(Streamlit Cloud의 Settings > Secrets)에만 저장하고,
# 같은 값을 Apps Script 쪽 스크립트 속성(SECRET_TOKEN)에도 넣어야 서로 짝이 맞습니다.
# 토큰이 설정돼 있지 않으면 경고만 띄우고, 기존처럼 인증 없이 동작합니다(하위 호환).
sheet_api_token = st.secrets.get("SHEET_API_TOKEN", "").strip()

def _mask_secrets(text):
    """오류 문장에 섞여 들어올 수 있는 비밀값(주소·토큰·API 키)을 *** 로 가린다."""
    text = str(text)
    for key in ("GOOGLE_SHEET_URL", "SHEET_API_TOKEN", "GEMINI_API_KEY", "MATHPIX_APP_KEY", "MATHPIX_APP_ID",
                "ADMIN_PASSWORD", "PASSWORD_SALT", "LOGIN_SECRET", "SUPABASE_DB_URL"):
        v = str(st.secrets.get(key, "") or "").strip()
        if v:
            text = text.replace(v, "***")
    return text


def safe_error(prefix, e):
    """화면에는 일반 문구만 보여 주고, 자세한 내용은 비밀값을 가린 채 서버 로그에만 남긴다.
    (requests 오류 문장에는 token=... 이 들어간 주소가 그대로 있어서 화면에 찍으면 안 된다)"""
    logging.error("%s: %s", prefix, _mask_secrets(e))
    st.error(f"{prefix} 잠시 후 다시 시도해 주세요. 계속되면 선생님께 알려 주세요.")


# ★ 읽기 캐시: Streamlit은 버튼을 누를 때마다 모든 탭을 다시 그리므로, 구글 시트에서 읽은 결과를
# 잠깐(60초) 기억해 두고 다시 쓴다. 저장·삭제·수정 같은 쓰기를 하면 바로 지워서 새 내용이 보이게 한다.
# 실패한 응답(오류, 인증 실패)은 기억하지 않는다.
class _UncachedResult(Exception):
    def __init__(self, data):
        super().__init__("uncached")
        self.data = data


@st.cache_data(ttl=60, show_spinner=False, max_entries=500)
def _cached_get_json(params_items, timeout):
    params = dict(params_items)
    params["t"] = int(time.time() * 1000)
    if sheet_api_token:
        params["token"] = sheet_api_token
    res = requests.get(sheet_url, params=params, timeout=timeout)
    if res.status_code != 200:
        raise RuntimeError(f"서버 오류 (status {res.status_code})")
    data = res.json()
    if isinstance(data, dict) and data.get("error"):
        raise _UncachedResult(data)
    return data


def _get_json(params, timeout=30):
    """구글 시트 GET 요청 (60초 캐시). 네트워크 오류는 그대로 예외로 올라간다."""
    key = tuple(sorted((k, str(v)) for k, v in params.items() if v is not None))
    try:
        return _cached_get_json(key, timeout)
    except _UncachedResult as e:
        return e.data


def invalidate_reads():
    """쓰기 후 호출: 기억해 둔 읽기 결과를 모두 지워 다음 화면에서 새로 읽게 한다."""
    _cached_get_json.clear()
    _db_students.clear()
    _db_status.clear()
    _db_bank_search.clear()
    for fn in ("archive_types", "taxonomy_list"):
        f = globals().get(fn)
        if f is not None:
            f.clear()


def fetch_problems(class_id=None, since_date=None):
    """구글 시트에서 과제 불러오기 (캐시 방지 적용)
    class_id, since_date를 지정하면 Apps Script가 서버에서 미리 걸러서
    보내주기 때문에, 데이터가 아무리 쌓여도 매번 받는 양이 일정하게 유지됩니다.
    class_id: 특정 반만 (예: "1M2")
    since_date: 이 날짜(YYYY-MM-DD) 이후 과제만
    """
    if not sheet_url:
        if os.path.exists("shared_problems.json"):
            with open("shared_problems.json", "r", encoding="utf-8") as f:
                all_local = json.load(f)
        else:
            all_local = []
        # 로컬 모드에서는 데이터량이 적으므로 파이썬에서 간단히 필터링
        if class_id:
            all_local = [p for p in all_local if str(p.get("class_id", "")).strip() == class_id.strip()]
        if since_date:
            all_local = [p for p in all_local if str(p.get("date", "")) >= since_date]
        return all_local
    
    try:
        params = {}
        if class_id:
            params["class_id"] = class_id
        if since_date:
            params["since"] = since_date
        data = _get_json(params, timeout=30)
        if isinstance(data, list):
            return data
        elif isinstance(data, str):
            return json.loads(data)
        elif isinstance(data, dict) and data.get("error"):
            # ★ 보안 수정: 토큰 불일치 등으로 거부된 경우 화면에 바로 표시
            # (예전에는 이 경우 그냥 빈 목록으로 처리되어 원인을 알기 어려웠음)
            st.error(
                f"⚠️ 구글 시트 인증 실패: '{data.get('error')}'. "
                "SHEET_API_TOKEN과 Apps Script의 SECRET_TOKEN 값이 일치하는지, "
                "Apps Script가 새 버전으로 재배포됐는지 확인해 주세요."
            )
    except Exception as e:
        safe_error("데이터베이스 연결 오류가 있어요.", e)
    return []

def compress_image_for_storage(image_b64, max_dimension=700, max_chars=40000):
    """구글 시트 셀 용량 제한(50,000자)에 안전하게 걸리도록 사진을 압축.
    화질/크기를 단계적으로 낮춰가며 base64 길이가 max_chars 이하가 될 때까지 시도한다.
    (OCR용 원본과는 별개로, 저장/미리보기용 사본만 이렇게 줄인다)
    """
    if not image_b64:
        return ""
    try:
        raw = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(raw))
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        w, h = img.size
        scale = min(1.0, max_dimension / max(w, h))
        if scale < 1.0:
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))))

        quality = 60
        encoded = ""
        while quality >= 20:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            encoded = base64.b64encode(buf.getvalue()).decode("utf-8")
            if len(encoded) <= max_chars:
                return encoded
            quality -= 10

        # 화질을 최소치까지 낮춰도 넘으면, 크기 자체를 한 번 더 줄여서 최종 시도
        img = img.resize((max(1, int(img.width * 0.6)), max(1, int(img.height * 0.6))))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=40)
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception:
        # 압축 자체가 실패해도 과제 등록 전체가 막히면 안 되므로, 사진 없이 진행
        return ""


def save_problem(problem_data):
    """구글 시트에 새 과제 추가하기"""
    if not sheet_url:
        curr = fetch_problems()
        curr.insert(0, problem_data)
        with open("shared_problems.json", "w", encoding="utf-8") as f:
            json.dump(curr, f, ensure_ascii=False, indent=2)
        return True
    
    try:
        # ★ 보안 수정: 실제 문제 데이터에 비밀 토큰을 함께 담아 전송.
        # Apps Script가 이 토큰을 확인해서 일치할 때만 저장을 허용합니다.
        payload = dict(problem_data)
        payload["_token"] = sheet_api_token
        res = requests.post(sheet_url, json=payload, timeout=10)
        invalidate_reads()
        return res.status_code == 200
    except Exception as e:
        safe_error("과제를 등록하지 못했어요.", e)
        return False

def delete_problem(prob_id):
    """구글 시트에서 특정 과제 삭제하기"""
    if not sheet_url:
        curr = fetch_problems()
        curr = [p for p in curr if str(p.get('id')) != str(prob_id)]
        with open("shared_problems.json", "w", encoding="utf-8") as f:
            json.dump(curr, f, ensure_ascii=False, indent=2)
        return True
    
    try:
        # ★ 보안 수정: 삭제 요청에도 비밀 토큰을 함께 전송.
        res = requests.post(
            sheet_url,
            json={"action": "delete", "id": str(prob_id), "_token": sheet_api_token},
            timeout=10,
        )
        invalidate_reads()
        return res.status_code == 200
    except Exception as e:
        safe_error("과제를 삭제하지 못했어요.", e)
        return False

# ==========================================
# ★ 학생 개인 계정 + 개인 보관함
# ==========================================
password_salt = st.secrets.get("PASSWORD_SALT", "").strip()

def hash_password(raw_password):
    """비밀번호를 평문으로 저장/전송하지 않기 위한 해시 처리.
    Streamlit(파이썬) 쪽에서만 해시를 계산하고, Apps Script는 해시값만
    저장·비교한다 (평문 비밀번호가 서버 쪽 코드에 전혀 남지 않음)."""
    return hashlib.sha256((password_salt + raw_password).encode("utf-8")).hexdigest()


# ★ 저장 방식 선택: Secrets의 STORAGE_BACKEND = "sheet"(기본, 구글 시트) 또는 "supabase".
# 기능별로 옮기는 중이라, supabase로 바꾸면 옮겨진 기능만 새 데이터베이스를 쓴다. 문제가 생기면 sheet로 되돌린다.
def storage_backend():
    """Secrets의 STORAGE_BACKEND 값. 'sheet'(기본, 지금 방식) 또는 'supabase'."""
    v = str(st.secrets.get("STORAGE_BACKEND", "sheet") or "sheet").strip().lower()
    return v if v in ("sheet", "supabase") else "sheet"


@st.cache_resource(show_spinner=False)
def _db_connect(url):
    return dbconn.Db(url)


def _db_url():
    return str(st.secrets.get("SUPABASE_DB_URL", "") or "").strip()


_DB_MISSING = {"ok": False, "error": "데이터베이스 연결 주소(SUPABASE_DB_URL)가 설정되지 않았습니다."}


def _db_write(name, *args, **kwargs):
    """데이터베이스에 쓰기(계정 등). Apps Script와 같은 {"ok": ..., "error": ...} 모양으로 돌려준다."""
    url = _db_url()
    if not url:
        return dict(_DB_MISSING)
    result = getattr(_db_connect(url), name)(*args, **kwargs)
    if name != "login":
        invalidate_reads()
    return result


@st.cache_data(ttl=60, show_spinner=False)
def _db_students(url):
    return _db_connect(url).list_students()


@st.cache_data(ttl=60, show_spinner=False)
def _db_status(url):
    return _db_connect(url).get_status()


@st.cache_data(ttl=60, show_spinner=False, max_entries=300)
def _db_bank_search(url, args_json):
    return _db_connect(url).bank_search(**json.loads(args_json))


def _db_image_upload(image_b64, name):
    """원본 사진은 구글 드라이브에 둔다(Apps Script 버전 9의 image_save). (파일 id, 오류 문장)을 돌려준다."""
    if backend_version() < 9:
        return None, "사진을 저장하려면 Apps Script를 최신 버전(9)으로 재배포해 주세요."
    res = _post_action({"action": "image_save", "image_b64": image_b64, "name": name})
    if res.get("ok") and res.get("file_id"):
        return res["file_id"], None
    return None, res.get("error") or "사진을 올리지 못했어요."


def _db_image_discard(file_id):
    """저장하지 못한 문제의 사진을 드라이브에서 치운다(실패해도 무시)."""
    if file_id:
        _post_action({"action": "image_trash", "file_id": file_id})


def _db_bank_save(problems, image_b64, group_id):
    """문제 은행 저장(데이터베이스). 사진은 드라이브에 올리고 문제에는 파일 id만 저장한다.
    저장이 안 되면 올린 사진도 치운다."""
    url = _db_url()
    if not url:
        return dict(_DB_MISSING)
    db = _db_connect(url)
    file_id = ""
    try:
        already = bool(problems) and db.bank_search(ids=db.bank_ids_for(group_id, 1))["total"] > 0
        if image_b64 and any(p.get("use_image") for p in problems) and not already:
            file_id, err = _db_image_upload(image_b64, group_id)
            if err:
                return {"ok": False, "error": err}
        res = db.bank_save(group_id, problems, file_id or "")
    except Exception as e:
        _db_image_discard(file_id)
        logging.error("문제 은행 저장 실패: %s", _mask_secrets(e))
        return {"ok": False, "error": "데이터베이스 오류가 발생했어요. 잠시 후 다시 시도해 주세요."}
    if file_id and (not res.get("ok") or res.get("duplicate")):
        _db_image_discard(file_id)
    invalidate_reads()
    return res


def _post_action(payload):
    """Apps Script에 action 기반 POST 요청을 보내는 공통 헬퍼 (계정/보관함용)."""
    if not sheet_url:
        return {"ok": False, "error": "로컬 모드에서는 계정 기능을 사용할 수 없습니다."}
    try:
        payload = dict(payload)
        payload["_token"] = sheet_api_token
        res = requests.post(sheet_url, json=payload, timeout=15)
        if payload.get("action") != "login":
            invalidate_reads()
        if res.status_code == 200:
            return res.json()
        return {"ok": False, "error": f"서버 오류 (status {res.status_code})"}
    except Exception as e:
        return {"ok": False, "error": _mask_secrets(e)}


def student_signup(student_id, password):
    """학생 회원가입. 반은 아직 배정되지 않은 상태(class_id="")로 생성됨."""
    if storage_backend() == "supabase":
        return _db_write("signup", student_id, hash_password(password))
    return _post_action({
        "action": "signup",
        "student_id": student_id.strip(),
        "password_hash": hash_password(password),
    })


def student_login(student_id, password):
    """학생 로그인. 성공하면 {'ok': True, 'class_id': ...} 반환."""
    if storage_backend() == "supabase":
        return _db_write("login", student_id, hash_password(password))
    return _post_action({
        "action": "login",
        "student_id": student_id.strip(),
        "password_hash": hash_password(password),
    })


def admin_assign_class(student_id, class_id):
    """관리자가 특정 학생에게 반을 배정."""
    if storage_backend() == "supabase":
        return bool(_db_write("assign_class", student_id, class_id).get("ok"))
    result = _post_action({
        "action": "assign_class",
        "student_id": student_id,
        "class_id": class_id,
    })
    return bool(result.get("ok"))


def student_withdraw(student_id, password):
    """학생 본인 탈퇴 - 비밀번호 재확인 필요. 계정+개인보관함이 함께 삭제됨."""
    if storage_backend() == "supabase":
        return _db_write("withdraw", student_id, hash_password(password), by_admin=False)
    return _post_action({
        "action": "withdraw",
        "student_id": student_id,
        "password_hash": hash_password(password),
        "by_admin": False,
    })


def admin_withdraw_student(student_id):
    """관리자가 특정 학생을 강제 탈퇴 - 비밀번호 확인 없이 즉시 처리. 계정+개인보관함이 함께 삭제됨."""
    if storage_backend() == "supabase":
        return bool(_db_write("withdraw", student_id, "", by_admin=True).get("ok"))
    result = _post_action({
        "action": "withdraw",
        "student_id": student_id,
        "by_admin": True,
    })
    return bool(result.get("ok"))


def admin_list_students():
    """관리자용 - 전체 학생 아이디와 배정된 반 목록 (비밀번호 해시는 절대 포함 안 됨)."""
    if storage_backend() == "supabase":
        if not _db_url():
            return []
        try:
            return _db_students(_db_url())
        except Exception as e:
            safe_error("학생 목록을 불러오지 못했어요.", e)
            return []
    if not sheet_url:
        return []
    try:
        data = _get_json({"action": "list_students"}, timeout=15)
        if isinstance(data, list):
            return data
    except Exception as e:
        safe_error("학생 목록을 불러오지 못했어요.", e)
    return []


def fetch_personal_problems(student_id, source=None):
    """특정 학생의 개인 보관함 조회. source='self'(스스로 만든 것) 또는 'board'(게시판에서 저장한 것)."""
    if not sheet_url:
        return []
    try:
        params = {"sheet": "personal_problems", "student_id": student_id, "t": int(time.time() * 1000)}
        if source:
            params["source"] = source
        if sheet_api_token:
            params["token"] = sheet_api_token
        res = requests.get(sheet_url, params=params, timeout=15)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list):
                return data
    except Exception as e:
        safe_error("보관함을 불러오지 못했어요.", e)
    return []


def build_personal_payload(student_id, class_id, source, origin_id, q1, a1, s1, q2, a2, s2, image_b64=""):
    return {
        "id": f"{int(time.time() * 1000)}_{student_id}",
        "student_id": student_id,
        "class_id": class_id or "",
        "source": source,  # "self"(스스로 생성) 또는 "board"(게시판에서 저장)
        "origin_id": origin_id or "",
        "date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "image_b64": image_b64 or "",
        "q1": q1, "a1": a1, "s1": s1,
        "q2": q2, "a2": a2, "s2": s2,
    }


def save_personal_problem(data):
    result = _post_action(dict(data, action="save_personal"))
    return result.get("status") == "success"


def delete_personal_problem(student_id, prob_id):
    result = _post_action({
        "action": "delete_personal",
        "student_id": student_id,
        "id": prob_id,
    })
    return result.get("status") == "deleted"


STATUS_FILE = "app_status.txt"  # 로컬(구글시트 미연동) 개발 모드에서만 쓰이는 대체 저장소

def get_app_status():
    """앱 전체 ON/OFF 상태 조회.
    ★ 수정: 예전에는 서버 로컬 디스크에 파일로 저장했는데, Streamlit Cloud처럼
    디스크가 휘발성인 환경에서는 서버가 재시작(재배포, 절전 후 재가동 등)될
    때마다 값이 사라져서 수업 도중 갑자기 OFF로 리셋되는 문제가 있었음.
    이제는 Apps Script의 스크립트 속성(구글 쪽)에 저장해서, 서버가 몇 번을
    재시작해도 값이 유지되도록 함.
    """
    if storage_backend() == "supabase":
        if not _db_url():
            return "OFF"
        try:
            return _db_status(_db_url())
        except Exception as e:
            logging.error("앱 상태를 읽지 못했어요: %s", _mask_secrets(e))
            return "OFF"
    if not sheet_url:
        if os.path.exists(STATUS_FILE):
            with open(STATUS_FILE, "r") as f:
                return f.read().strip()
        return "OFF"
    try:
        data = _get_json({"action": "get_status"}, timeout=10)
        if isinstance(data, dict):
            return data.get("status", "OFF")
    except Exception:
        pass
    return "OFF"

def set_app_status(status):
    if storage_backend() == "supabase":
        res = _db_write("set_status", status)
        if not res.get("ok"):
            st.error(res.get("error", "앱 상태를 바꾸지 못했어요."))
        return
    if not sheet_url:
        with open(STATUS_FILE, "w") as f:
            f.write(status)
        return
    _post_action({"action": "set_status", "status": status})

# ==========================================
# ★ 선생님 문제 보관함 (Apps Script 'archive' 탭 + 구글 드라이브 사진 폴더)
# 날짜 / 대상 학생 / 학년 › 단원 › 세부 유형 별로 오래 쌓아두고 검색한다.
# ==========================================
def _get_action(params, timeout=30):
    """Apps Script에 GET 요청을 보내는 공통 헬퍼 (보관함 조회용)."""
    if not sheet_url:
        return None
    try:
        return _get_json(params, timeout=timeout)
    except Exception as e:
        safe_error("보관함을 불러오지 못했어요.", e)
    return None


def archive_save(data):
    """보관함에 문제 세트 1개 저장. 사진(image_b64)은 Apps Script가 드라이브에 따로 저장한다."""
    return _post_action(dict(data, action="archive_save"))


def archive_delete(prob_id):
    result = _post_action({"action": "archive_delete", "id": prob_id})
    return bool(result.get("ok"))


def archive_update_students(prob_id, student_ids):
    result = _post_action({"action": "archive_update_students", "id": prob_id, "student_ids": ",".join(student_ids)})
    return bool(result.get("ok"))


# 문제 구분: 원본 문제와 유사문제 1번·2번, 숙제 문제마다 여러 개를 함께 고를 수 있다
TAG_NAMES = ["중요", "틀림", "어려워함"]
TAG_ICON = {"중요": "⭐", "틀림": "❌", "어려워함": "😣"}


def tag_list(v):
    parts = v if isinstance(v, (list, tuple, set)) else str(v or "").split(",")
    parts = {str(x).strip() for x in parts}
    return [t for t in TAG_NAMES if t in parts]


def tag_text(v):
    return " ".join(f"{TAG_ICON[t]}{t}" for t in tag_list(v))


def item_tags(item, student_id):
    """보관함 문제 1세트에서 그 학생의 구분 ([원본], [1번], [2번]). 학생별 구분이 없으면 세트 공통 구분."""
    try:
        per = json.loads(item.get("student_tags") or "{}")
    except (TypeError, ValueError):
        per = {}
    if isinstance(per, dict) and isinstance(per.get(student_id), list):
        t = per[student_id] + ["", "", ""]
        return tag_list(t[0]), tag_list(t[1]), tag_list(t[2])
    return tag_list(item.get("tags")), tag_list(item.get("tags1")), tag_list(item.get("tags2"))


def student_tags_json(per):
    """{학생: ([원본], [1번], [2번])} → 저장용 JSON 글자 (구분이 하나도 없는 학생은 뺀다)."""
    out = {sid: [",".join(tag_list(x)) for x in t] for sid, t in per.items() if any(tag_list(x) for x in t)}
    return json.dumps(out, ensure_ascii=False) if out else ""


def archive_set_student_tags(prob_id, per):
    return bool(_post_action({"action": "archive_update_tags", "id": prob_id,
                              "student_tags": student_tags_json(per)}).get("ok"))


def archive_search(student="", class_id="", grade="", unit="", subtype="",
                   date_from="", date_to="", keyword="", offset=0, limit=30):
    """조건에 맞는 보관 문제를 최신순으로 offset부터 limit개. {'items': [...], 'total': n} 반환."""
    params = {"action": "archive_search", "offset": offset, "limit": limit}
    for k, v in (("student", student), ("class_id", class_id), ("grade", grade), ("unit", unit),
                 ("subtype", subtype), ("date_from", date_from), ("date_to", date_to), ("keyword", keyword)):
        if v:
            params[k] = v
    data = _get_action(params, timeout=60)
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data
    return {"items": [], "total": 0}


@st.cache_data(ttl=120, show_spinner=False)
def archive_types():
    """지금까지 보관함에 쓰인 (학년, 단원, 세부 유형) 목록과 개수."""
    data = _get_action({"action": "archive_types"})
    if not isinstance(data, list):
        return []
    # 예전 Apps Script는 이 요청에 게시판 목록을 돌려주므로, 유형 칸이 있는 항목만 쓴다
    return [t for t in data if isinstance(t, dict) and "subtype" in t]


def archive_stats(date_from="", date_to="", class_id=""):
    params = {"action": "archive_stats"}
    if date_from:
        params["date_from"] = date_from
    if date_to:
        params["date_to"] = date_to
    if class_id:
        params["class_id"] = class_id
    data = _get_action(params, timeout=60)
    if not isinstance(data, list):
        return []
    return [r for r in data if isinstance(r, dict) and "student_id" in r and "subtype" in r]


@st.cache_data(ttl=60, show_spinner=False)
def archive_backend_ready():
    """Apps Script가 보관함 기능이 있는 새 버전인지 확인.
    예전 버전은 보관함 요청을 알아보지 못하고 게시판 목록을 돌려주거나(조회),
    게시판 시트에 엉뚱한 줄을 추가하므로(저장), 새 버전일 때만 보관함을 쓰게 한다."""
    if not sheet_url:
        return False
    data = _get_action({"action": "archive_search", "limit": 1})
    return isinstance(data, dict) and isinstance(data.get("items"), list)


ARCHIVE_SETUP_MSG = (
    "⚠️ 구글 Apps Script가 아직 예전 버전이라 문제 보관함을 쓸 수 없습니다. "
    "저장소의 apps_script/Code.gs 내용으로 Apps Script를 바꾸고 '새 버전'으로 재배포한 뒤, 1분쯤 지나 새로고침해 주세요."
)


@st.cache_data(ttl=3600, show_spinner=False, max_entries=200)
def archive_image(file_id):
    """드라이브에 보관된 원본 사진(base64). 한 번 불러온 사진은 1시간 동안 다시 받지 않는다."""
    if not file_id:
        return ""
    data = _get_action({"action": "archive_image", "file_id": file_id})
    if isinstance(data, dict) and data.get("ok"):
        return data.get("image_b64", "")
    return ""



# ==========================================
# ★ 학생 중요 문제함 (Apps Script 'stars' 탭)
# 학생이 받은 문제 중 다시 보고 싶은 문제를 체크해 둔다. key = "보관함 문제 id|1" 또는 "|2"
# ==========================================
@st.cache_data(ttl=60, show_spinner=False)
def stars_backend_ready():
    """Apps Script가 중요 문제함 기능이 있는 버전인지 확인 (예전 버전에 저장 요청을 보내면 게시판에 엉뚱한 줄이 생김)."""
    if not sheet_url:
        return False
    data = _get_action({"action": "star_items", "student_id": "_check_"})
    return isinstance(data, dict) and isinstance(data.get("items"), list)


def star_keys(student_id):
    data = _get_action({"action": "star_list", "student_id": student_id})
    if not isinstance(data, list):
        return set()
    return {k for k in data if isinstance(k, str)}


def star_set(student_id, item_key, on):
    result = _post_action({"action": "star_set", "student_id": student_id, "item_key": item_key, "on": bool(on)})
    return bool(result.get("ok"))


def star_items(student_id):
    data = _get_action({"action": "star_items", "student_id": student_id}, timeout=60)
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    return []


# ==========================================
# ★ 숙제 · 채점 · 시험 점수 (Apps Script 'homework' / 'hw_results' / 'exams' 탭)
# 숙제는 문제 은행의 문제 id 목록만 저장한다. 채점 결과는 학생·숙제·문제 id·낸 답·O/X만 남긴다.
# ==========================================
@st.cache_data(ttl=60, show_spinner=False)
def backend_version():
    """Apps Script 버전 (3 = 숙제·채점·시험 점수, 4 = 학교 시험지 분석 저장). 모르면 0."""
    if not sheet_url:
        return 0
    data = _get_action({"action": "version"})
    try:
        return int(data.get("version", 0)) if isinstance(data, dict) else 0
    except (TypeError, ValueError):
        return 0


def hw_backend_ready():
    """Apps Script가 숙제·채점 기능이 있는 버전(3 이상)인지 확인."""
    return backend_version() >= 3


def tags_backend_ready():
    """학생별 문제 구분(중요·틀림·어려워함)과 단원 학기를 저장할 수 있는 버전(6 이상)인지 확인."""
    return backend_version() >= 6


def backup_ready():
    """Apps Script가 백업 기능이 있는 버전(8 이상)인지 확인."""
    return backend_version() >= 8


def backup_info():
    data = _get_action({"action": "backup_info"})
    return data if isinstance(data, dict) and "last_at" in data else {}


def backup_now():
    return _post_action({"action": "backup_now"})


TAGS_SETUP_MSG = "문제 구분을 저장하려면 저장소의 apps_script/Code.gs로 Apps Script를 바꾸고 '새 버전'으로 재배포해 주세요."


HW_SETUP_MSG = (
    "⚠️ 구글 Apps Script가 아직 숙제·채점 기능이 없는 버전입니다. "
    "저장소의 apps_script/Code.gs 내용으로 바꾸고, [배포 관리]에서 기존 배포를 '새 버전'으로 수정해 주세요."
)


def hw_list(student_id="", class_id="", limit=200):
    params = {"action": "hw_list", "limit": limit}
    if student_id:
        params["student_id"] = student_id
    if class_id:
        params["class_id"] = class_id
    data = _get_action(params)
    return [h for h in data if isinstance(h, dict) and "hw_id" in h] if isinstance(data, list) else []


def hw_save(title, due_date, class_id, student_ids, problem_ids, memo=""):
    return _post_action({"action": "hw_save", "title": title, "due_date": due_date, "class_id": class_id,
                         "student_ids": list(student_ids), "problem_ids": list(problem_ids), "memo": memo})


def hw_delete(hw_id):
    return bool(_post_action({"action": "hw_delete", "hw_id": hw_id}).get("ok"))


def hw_results(hw_id="", student_id=""):
    params = {"action": "hw_results"}
    if hw_id:
        params["hw_id"] = hw_id
    if student_id:
        params["student_id"] = student_id
    data = _get_action(params, timeout=60)
    return [r for r in data if isinstance(r, dict) and "problem_id" in r] if isinstance(data, list) else []


def hw_submit(hw_id, student_id, answers):
    return bool(_post_action({"action": "hw_submit", "hw_id": hw_id, "student_id": student_id,
                              "answers": answers}).get("ok"))


def hw_mark(hw_id, student_id, marks):
    return bool(_post_action({"action": "hw_mark", "hw_id": hw_id, "student_id": student_id,
                              "marks": marks}).get("ok"))


def hw_tag(hw_id, student_id, tags):
    """숙제 문제에 구분(어려워함·중요)을 체크. tags = [{problem_id, tags: "어려워함,중요"}]"""
    return bool(_post_action({"action": "hw_tag", "hw_id": hw_id, "student_id": student_id,
                              "tags": tags}).get("ok"))


def exam_list(student_id=""):
    params = {"action": "exam_list"}
    if student_id:
        params["student_id"] = student_id
    data = _get_action(params)
    return [r for r in data if isinstance(r, dict) and "score" in r] if isinstance(data, list) else []


def exam_save(student_id, date, kind, name, score, max_score, memo=""):
    return bool(_post_action({"action": "exam_save", "student_id": student_id, "date": date, "kind": kind,
                              "name": name, "score": score, "max_score": max_score, "memo": memo}).get("ok"))


def exam_delete(exam_id):
    return bool(_post_action({"action": "exam_delete", "id": exam_id}).get("ok"))


def exam_set_analysis(exam_id, analysis):
    return bool(_post_action({"action": "exam_analysis", "id": exam_id,
                              "analysis": json.dumps(analysis, ensure_ascii=False)}).get("ok"))


def exam_analysis_of(exam):
    """시험 기록에 저장된 시험지 분석(JSON). 없으면 빈 dict."""
    try:
        a = json.loads(exam.get("analysis") or "{}")
        return a if isinstance(a, dict) else {}
    except (TypeError, ValueError):
        return {}


def bank_by_ids(ids):
    """문제 은행 문제들을 id로 한꺼번에 불러온다. {id: 문제} 반환."""
    ids = [i for i in dict.fromkeys(str(x) for x in ids) if i]
    out = {}
    for k in range(0, len(ids), 80):
        chunk = ids[k:k + 80]
        for p in bank_search(limit=len(chunk), ids=chunk)["items"]:
            out[p.get("id")] = p
    return out


# ---------- 자동 채점 ----------
# 결과: 'Y' 맞음 / 'N' 틀림 / '?' 자동으로 단정하기 어려워 선생님 확인 필요
# 원칙: 확실히 같으면 Y, 확실히 다르면 N, 식의 꼴만 다르거나 읽을 수 없으면 ?(선생님이 확인)
_CIRCLED = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
_NUM = r"[-+]?\d+(?:\.\d+)?"
_REL_RE = re.compile(r"<=|>=|!=|<|>")


def _top_split(s, seps=(",",)):
    """괄호 밖에 있는 구분 글자로만 나눈다. '(1,2)'는 한 덩어리로 둔다."""
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if depth == 0 and ch in seps:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts


def _canon_number(x):
    """숫자·분수·소수를 같은 꼴(기약분수)로. 숫자가 아니면 None."""
    m = re.fullmatch(r"([-+]?)\(?(" + _NUM + r")\)?/\(?(" + _NUM + r")\)?", x)
    try:
        if m:
            val = Fraction(m.group(2)) / Fraction(m.group(3))
            return str(-val if m.group(1) == "-" else val)
        if re.fullmatch(_NUM, x):
            return str(Fraction(x))
    except (ValueError, ZeroDivisionError):
        pass
    return None


def _canon_expr(x):
    """식을 항 단위로 나눠 순서 없이 비교할 수 있는 꼴로: 1+2x == 2x+1."""
    x = x.replace("*", "")
    terms, depth, cur = [], 0, ""
    for i, ch in enumerate(x):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if depth == 0 and ch in "+-" and cur and cur[-1] not in "^(/*":
            terms.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        terms.append(cur)
    out = []
    for t in terms:
        t = t[1:] if t.startswith("+") else t
        out.append(_canon_number(t) or t)
    return "+".join(sorted(out))


def _canon_value(x):
    num = _canon_number(x)
    return num if num is not None else _canon_expr(x)


def _canon_part(x):
    """답 한 덩어리를 비교용 글자로. 앞뒤 군더더기(답:, 단위, x=)와 숫자 꼴을 정리한다."""
    for k, v in _CIRCLED.items():
        x = x.replace(k, v)
    x = x.strip().strip(".").strip()
    x = re.sub(r"^(답|정답)[:：]?", "", x)
    x = re.sub(r"(?<=\d)(cm|mm|km)\^?[23]?$", "", x)
    x = re.sub(r"(?<=\d)[가-힣°%]+$", "", x)               # 5개, 30° → 숫자만
    if x.startswith("(") and x.endswith(")") and len(_top_split(x[1:-1])) > 1:
        return "(" + ",".join(_canon_value(p) for p in _top_split(x[1:-1])) + ")"   # 좌표 (1,2): 순서 있음
    rels = _REL_RE.findall(x)
    if len(rels) == 1:                                       # 부등식: 3<x 와 x>3 은 같다
        left, right = _REL_RE.split(x)
        rel = rels[0]
        if rel in (">", ">="):
            left, right, rel = right, left, rel.replace(">", "<")
        return f"{_canon_value(left)}{rel}{_canon_value(right)}"
    return _canon_value(x)


def norm_answer(s):
    """답을 비교하기 좋은 꼴(글자 목록)로.
    $·띄어쓰기 제거, \\frac{a}{b} → a/b, 천 단위 쉼표 제거, 괄호 밖 쉼표로 여러 답 나누기(순서 무관),
    좌표 (1,2)는 한 덩어리, 변수가 둘 이상인 연립 답(x=3, y=2)은 변수 이름을 남긴다."""
    s = str(s or "")
    for a, b in (("$", ""), ("\\left", ""), ("\\right", ""), ("\\,", ""), ("\\ ", ""), ("−", "-"),
                 ("×", "*"), ("÷", "/"), ("\\times", "*"), ("\\div", "/"), ("\\cdot", "*"),
                 ("≤", "<="), ("≥", ">="), ("≠", "!="), ("²", "^2"), ("³", "^3"), ("\\pi", "pi"), ("π", "pi")):
        s = s.replace(a, b)
    s = re.sub(r"\\leq?(?![a-z])", "<=", s)
    s = re.sub(r"\\geq?(?![a-z])", ">=", s)
    s = re.sub(r"\\sqrt\{([^{}]*)\}", r"sqrt(\1)", s)
    s = re.sub(r"\^\{([^{}]*)\}", r"^(\1)", s)
    s = re.sub(r"\\[dt]frac", r"\\frac", s)
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"(\1)/(\2)", s)
    s = s.lower()
    s = re.sub(r"(?<![\d.])\d{1,3}(?:,\d{3})+(?!\d)", lambda m: m.group(0).replace(",", ""), s)  # 1,000 → 1000
    s = re.sub(r"\s+or\s+|또는|그리고|;", ",", s)
    s = re.sub(r"\s+", "", s)
    raw = [p for p in _top_split(s) if p]
    assigned = [re.fullmatch(r"([a-z])=(.+)", p) for p in raw]
    keep_vars = all(assigned) and len({m.group(1) for m in assigned}) > 1
    items = []
    for p, m in zip(raw, assigned):
        if m and not keep_vars:
            p = m.group(2)                                   # x=3 → 3
        elif m:
            p = m.group(1) + "=" + _canon_part(m.group(2))
            items.append(p)
            continue
        items.append(_canon_part(p))
    return sorted(set(items))


# 식의 값을 직접 계산해서 "꼴은 다르지만 같은 식"인지 확인한다 (곱셈 생략 2x, 거듭제곱 ^, sqrt, pi 지원)
_EVAL_POINTS = [{"base": 1.7}, {"base": -2.3}, {"base": 0.6}]


def _eval_expr(expr, env):
    e = expr.replace("sqrt", "§").replace("pi", "π")
    e = re.sub(r"(?<=[\d)a-zπ])(?=[a-zπ(])", "*", e)
    e = re.sub(r"§\*\(", "§(", e).replace("§", "sqrt").replace("^", "**")

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return float(n.value)
        if isinstance(n, ast.Name):
            if n.id == "π":
                return 3.141592653589793
            if n.id in env:
                return env[n.id]
            raise ValueError(n.id)
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)):
            v = ev(n.operand)
            return v if isinstance(n.op, ast.UAdd) else -v
        if isinstance(n, ast.BinOp):
            a, b = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Add):
                return a + b
            if isinstance(n.op, ast.Sub):
                return a - b
            if isinstance(n.op, ast.Mult):
                return a * b
            if isinstance(n.op, ast.Div):
                return a / b
            if isinstance(n.op, ast.Pow) and abs(b) <= 12 and abs(a) <= 1e6:
                r = a ** b
                if isinstance(r, complex):
                    raise ValueError("complex")
                return r
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "sqrt" and len(n.args) == 1:
            v = ev(n.args[0])
            if v < 0:
                raise ValueError("neg sqrt")
            return v ** 0.5
        raise ValueError("unsupported")

    try:
        return ev(ast.parse(e, mode="eval"))
    except (ValueError, SyntaxError, ZeroDivisionError, OverflowError, TypeError, RecursionError):
        return None


def _same_value(a, b):
    """두 식이 값으로 같으면 True, 다르면 False, 계산할 수 없으면 None."""
    names = sorted(set(re.findall(r"[a-z]", a.replace("sqrt", "").replace("pi", ""))) |
                   set(re.findall(r"[a-z]", b.replace("sqrt", "").replace("pi", ""))))
    for k, pt in enumerate(_EVAL_POINTS):
        env = {nm: pt["base"] + (ord(nm) % 7) * 0.31 + k * 0.17 for nm in names}
        va, vb = _eval_expr(a, env), _eval_expr(b, env)
        if va is None or vb is None:
            return None
        if abs(va - vb) > 1e-7 * max(1.0, abs(va), abs(vb)):
            return False
    return True


def _compare_item(g, c):
    """답 한 개씩 비교: 'Y' / 'N' / '?'."""
    if g == c:
        return "Y"
    gn, cn = _canon_number(g), _canon_number(c)
    if gn is not None and cn is not None:
        return "N"
    if g.startswith("(") and c.startswith("("):                  # 좌표: 원소별로
        gp, cp = _top_split(g[1:-1]), _top_split(c[1:-1])
        if len(gp) != len(cp):
            return "N"
        res = {_compare_item(x, y) for x, y in zip(gp, cp)}
        return "Y" if res == {"Y"} else ("N" if "N" in res else "?")
    gr, cr = _REL_RE.findall(g), _REL_RE.findall(c)
    if gr or cr:
        if gr != cr or len(gr) != 1:
            return "N" if gr != cr else "?"
        res = {_compare_item(x, y) for x, y in zip(_REL_RE.split(g), _REL_RE.split(c))}
        return "?" if res == {"Y"} or "?" in res and "N" not in res else "N"
    if re.search(r"[^\x00-\x7f]", g + c):                      # 글자(ㄱ, 참/거짓 등)가 든 답은 식이 아니므로 다르면 틀림
        return "N"
    eq = _same_value(g, c)
    if eq is None:
        return "?"
    return "?" if eq else "N"                                  # 값은 같고 꼴만 다름(예: 2(x+1) 과 2x+2) → 선생님 확인


def grade_answer(given, correct):
    """'Y' 맞음 / 'N' 틀림 / '?' 정답이 없거나 자동으로 단정하기 어려워 선생님 확인 필요.
    채점 중 예상치 못한 오류가 나도 제출이 막히지 않게 '?'(선생님 확인)로 돌려준다."""
    try:
        return _grade_answer(given, correct)
    except Exception:
        return "?"


def _grade_answer(given, correct):
    if not str(correct or "").strip():
        return "?"
    if not str(given or "").strip():
        return "N"
    g, c = norm_answer(given), norm_answer(correct)
    if g == c:
        return "Y"
    # 연립 답은 변수 이름을 남겨 비교한다. 학생이 변수 없이 쓰면 어느 값이 어느 변수인지 알 수 없어 선생님 확인
    plain = lambda items: sorted(i.split("=", 1)[1] if re.fullmatch(r"[a-z]=.+", i) else i for i in items)
    if not any("=" in i for i in g) and plain(g) == plain(c):
        return "?"
    rg = [i for i in g if i not in c]
    rc = [i for i in c if i not in g]
    if len(rg) != len(rc):
        return "N"
    if all(re.fullmatch(r"[a-z]=.+", i) for i in rg + rc):      # 변수별로 값을 비교
        gv = dict(i.split("=", 1) for i in rg)
        cv = dict(i.split("=", 1) for i in rc)
        if set(gv) != set(cv):
            return "N"
        res = {_compare_item(gv[k], cv[k]) for k in cv}
        return "N" if "N" in res else ("?" if "?" in res else "Y")
    if len(rg) == 1:
        return _compare_item(rg[0], rc[0])
    # 여러 개가 남으면: 하나라도 식이면 선생님 확인, 모두 숫자면 틀림
    if all(_canon_number(i) is not None for i in rg + rc):
        return "N"
    return "?"


# ==========================================
# ★ 문제 은행 (Apps Script 'bank' 탭 + 'taxonomy' 탭)
# 문제를 학생과 상관없이 한 문제씩 저장한다.
# 분류: 학년 › 단원 › 유형 › 문제틀(숫자·난이도만 다른 문제들의 묶음) + 난이도(하/중/상) + 검수 표시
# ==========================================
TAX_LEVELS = ["grade", "unit", "type", "frame"]
TAX_LABELS = {"grade": "학년", "unit": "단원", "type": "유형", "frame": "문제틀"}
DIFFICULTIES = ["하", "중", "상"]
SEMESTERS = ["1학기", "2학기", "공통"]
NEW_OPTION = "＋ 새로 입력"


def bank_search(limit=50, offset=0, **filters):
    """문제 은행 검색. filters: grade, unit, type, frame, difficulty(list), verified(bool), source, keyword, ids(list)."""
    if storage_backend() == "supabase":
        if not _db_url():
            return {"items": [], "total": 0}
        args = {"offset": offset, "limit": limit, "type_": filters.get("type", "") or ""}
        for k in ("grade", "unit", "frame", "source", "keyword"):
            args[k] = filters.get(k, "") or ""
        args["difficulty"] = list(filters.get("difficulty") or [])
        args["verified"] = bool(filters.get("verified"))
        args["ids"] = [str(i) for i in (filters.get("ids") or [])]
        try:
            return _db_bank_search(_db_url(), json.dumps(args, sort_keys=True, ensure_ascii=False))
        except Exception as e:
            safe_error("문제 은행을 불러오지 못했어요.", e)
            return {"items": [], "total": 0}
    params = {"action": "bank_search", "limit": limit, "offset": offset}
    for k in ("grade", "unit", "type", "frame", "source", "keyword"):
        if filters.get(k):
            params[k] = filters[k]
    if filters.get("difficulty"):
        params["difficulty"] = ",".join(filters["difficulty"])
    if filters.get("verified"):
        params["verified"] = "Y"
    if filters.get("ids"):
        params["ids"] = ",".join(filters["ids"])
    data = _get_action(params, timeout=60)
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data
    return {"items": [], "total": 0}


@st.cache_data(ttl=60, show_spinner=False)
def taxonomy_list():
    """유형표 전체 + 문제틀마다 문제 수(count), 검수 완료 수(verified), 난이도별 수."""
    if storage_backend() == "supabase":
        if not _db_url():
            return []
        try:
            return _db_connect(_db_url()).taxonomy_list()
        except Exception as e:
            logging.error("유형표를 읽지 못했어요: %s", _mask_secrets(e))
            return []
    data = _get_action({"action": "taxonomy"})
    if not isinstance(data, list):
        return []
    return [t for t in data if isinstance(t, dict) and "frame" in t]


@st.cache_data(ttl=60, show_spinner=False)
def bank_backend_ready():
    """Apps Script가 문제 은행 기능이 있는 버전인지 확인."""
    if storage_backend() == "supabase":
        return bool(_db_url())
    if not sheet_url:
        return False
    data = _get_action({"action": "bank_search", "limit": 1})
    return isinstance(data, dict) and isinstance(data.get("items"), list)


BANK_SETUP_MSG = (
    "⚠️ 구글 Apps Script가 아직 문제 은행 기능이 없는 버전입니다. "
    "저장소의 apps_script/Code.gs 내용으로 Apps Script를 바꾸고, [배포 관리]에서 기존 배포를 '새 버전'으로 수정해 주세요."
)


def _bank_changed():
    taxonomy_list.clear()


def bank_save(problems, image_b64="", group_id=""):
    """group_id를 주면 같은 group_id로 다시 저장해도 중복되지 않는다(서버가 이미 있으면 건너뜀)."""
    if storage_backend() == "supabase":
        res = _db_bank_save(problems, image_b64, group_id or str(int(time.time() * 1000)))
        if res.get("ok"):
            _bank_changed()
        return res
    result = _post_action({"action": "bank_save", "group_id": group_id or str(int(time.time() * 1000)),
                           "problems": problems, "image_b64": image_b64 or ""})
    if result.get("ok"):
        _bank_changed()
    return result


def save_assign_ready():
    """문제 은행 저장 + 학생 배정을 한 번에 하는 기능이 있는 Apps Script(버전 7 이상)인지 확인."""
    if storage_backend() == "supabase":
        return True
    return backend_version() >= 7


def save_and_assign(request_id, problems, image_b64, archive_payload):
    """문제 은행 저장과 학생 배정을 한 요청으로 처리한다. 둘 중 하나만 저장되고 끊기는 일이 없고,
    같은 request_id로 다시 보내도(두 번 클릭, 재시도) 중복 저장되지 않는다."""
    if storage_backend() == "supabase":
        # 문제 은행은 데이터베이스에 저장하고, 학생 배정은 5단계에서 옮기기 전까지 구글 시트(보관함)에 저장한다.
        # (옮기는 동안만 이렇게 두 곳에 나눠 저장하므로 한쪽만 저장될 수 있다. 5단계에서 한 번에 처리한다.)
        res = {"ok": True, "ids": []}
        if problems:
            res = _db_bank_save(problems, image_b64, request_id)
            if not res.get("ok"):
                return res
            _bank_changed()
        if archive_payload:
            arch = _post_action(dict(archive_payload, action="archive_save", id=request_id))
            if not arch.get("ok"):
                return {"ok": False, "error": arch.get("error", "학생 배정을 저장하지 못했어요.")}
            return {"ok": True, "ids": res.get("ids", []), "duplicate": False}
        return res
    body = {"action": "save_assign", "image_b64": image_b64 or ""}
    if problems:
        body["bank"] = {"group_id": request_id, "problems": problems}
    if archive_payload:
        body["archive"] = dict({k: v for k, v in archive_payload.items() if k != "image_b64"}, id=request_id)  # 사진은 한 번만 보낸다
    result = _post_action(body)
    if result.get("ok"):
        _bank_changed()
    return result


def bank_update(prob_id, **fields):
    if storage_backend() == "supabase":
        if not _db_url():
            return False
        result = _db_connect(_db_url()).bank_update(prob_id, fields)
        invalidate_reads()
        if result.get("ok"):
            _bank_changed()
        return bool(result.get("ok"))
    result = _post_action({"action": "bank_update", "id": prob_id, "fields": fields})
    if result.get("ok"):
        _bank_changed()
    return bool(result.get("ok"))


def bank_delete(prob_id):
    if storage_backend() == "supabase":
        if not _db_url():
            return False
        result = _db_connect(_db_url()).bank_delete(prob_id)
        invalidate_reads()
        if result.get("ok"):
            _db_image_discard(result.get("orphan_image", ""))
            _bank_changed()
            return True
        st.session_state["bank_err"] = result.get("error", "삭제하지 못했어요.")
        return False
    result = _post_action({"action": "bank_delete", "id": prob_id})
    if result.get("ok"):
        _bank_changed()
    return bool(result.get("ok"))


def taxonomy_upsert(grade, unit, type_, frame, description):
    if storage_backend() == "supabase":
        if not _db_url():
            return False
        result = _db_connect(_db_url()).taxonomy_upsert(grade, unit, type_, frame, description)
        invalidate_reads()
        _bank_changed()
        return bool(result.get("ok"))
    result = _post_action({"action": "taxonomy_upsert", "grade": grade, "unit": unit, "type": type_,
                           "frame": frame, "description": description})
    _bank_changed()
    return bool(result.get("ok"))


def taxonomy_rename(level, old, new):
    if storage_backend() == "supabase":
        if not _db_url():
            return dict(_DB_MISSING)
        result = _db_connect(_db_url()).taxonomy_rename(level, old, new)
        invalidate_reads()
        _bank_changed()
        return result
    payload = {"action": "taxonomy_rename", "level": level}
    for lv in TAX_LEVELS[:TAX_LEVELS.index(level) + 1]:
        payload["old_" + lv] = old.get(lv, "")
        payload["new_" + lv] = new.get(lv, "")
    result = _post_action(payload)
    _bank_changed()
    return result


@st.cache_data(ttl=300, show_spinner=False)
def unit_semesters():
    """단원별 학기 {(학년, 단원): '1학기'/'2학기'/'공통'}."""
    if storage_backend() == "supabase":
        if not _db_url():
            return {}
        try:
            data = _db_connect(_db_url()).unit_semesters()
        except Exception as e:
            logging.error("단원 학기를 읽지 못했어요: %s", _mask_secrets(e))
            return {}
    elif backend_version() < 6:
        return {}
    else:
        data = _get_action({"action": "unit_semesters"})
    if not isinstance(data, list):
        return {}
    return {(r.get("grade", ""), r.get("unit", "")): r.get("semester", "") for r in data if isinstance(r, dict) and r.get("unit")}


def unit_semester_set(grade, unit, semester):
    if not (unit and semester) or unit_semesters().get((grade, unit)) == semester:
        return True
    if storage_backend() == "supabase":
        ok = bool(_db_url()) and bool(_db_connect(_db_url()).unit_semester_set(grade, unit, semester).get("ok"))
    else:
        ok = bool(_post_action({"action": "unit_semester_set", "grade": grade, "unit": unit, "semester": semester}).get("ok"))
    unit_semesters.clear()
    return ok


def _short_q(p, n=40):
    """목록에 보여 줄 문제 앞부분 (줄바꿈·여러 칸 공백을 한 칸으로)."""
    return re.sub(r"\s+", " ", p.get("question", ""))[:n]


def frame_path(t):
    return " › ".join(x for x in [t.get("grade", ""), t.get("unit", ""), t.get("type", ""), t.get("frame", "")] if x) or "(분류 없음)"


def _children(taxonomy, level, parent):
    """parent(상위 단계 값들)에 속한 level 단계의 이름 목록."""
    idx = TAX_LEVELS.index(level)
    out = []
    for t in taxonomy:
        if all(t.get(TAX_LEVELS[i], "") == parent.get(TAX_LEVELS[i], "") for i in range(idx)):
            v = t.get(level, "")
            if v and v not in out:
                out.append(v)
    return sorted(out)


def taxonomy_picker(key_prefix, taxonomy, suggestion=None, allow_new=True, levels=TAX_LEVELS, with_semester=False):
    """학년 → (학기) → 단원 → 유형 → 문제틀 순서로 고르는 선택 상자. 기존 이름에서 고르거나 '새로 입력'.
    suggestion(AI 제안)이 기존 이름이면 그걸 미리 고르고, 새 이름이면 '새로 입력' 칸에 채워 둔다.
    with_semester면 학년 다음에 학기 칸을 넣는다 (기본값: 단원표에 저장된 학기 → AI 제안).
    반환: {'grade','unit','type','frame','is_new_frame'(, 'semester')}"""
    suggestion = suggestion or {}
    chosen = {}
    cols = st.columns(len(levels) + (1 if with_semester else 0))
    if with_semester:
        sem_default = unit_semesters().get((suggestion.get("grade", ""), suggestion.get("unit", ""))) or suggestion.get("semester", "")
        with cols[1]:
            chosen["semester"] = st.selectbox("학기", SEMESTERS, index=SEMESTERS.index(sem_default) if sem_default in SEMESTERS else 0,
                                              key=f"{key_prefix}_semester_sel")
    for i, lv in enumerate(levels):
        with cols[i + (1 if with_semester and i > 0 else 0)]:
            existing = _children(taxonomy, lv, chosen)
            options = existing + ([NEW_OPTION] if allow_new else [])
            if not options:
                options = [NEW_OPTION]
            sug = suggestion.get(lv, "")
            default = options.index(sug) if sug in options else (options.index(NEW_OPTION) if (sug and NEW_OPTION in options) else 0)
            pick = st.selectbox(TAX_LABELS[lv], options, index=default, key=f"{key_prefix}_{lv}_sel")
            if pick == NEW_OPTION:
                val = st.text_input(f"새 {TAX_LABELS[lv]} 이름", value=sug if sug not in existing else "",
                                    key=f"{key_prefix}_{lv}_new", label_visibility="collapsed",
                                    placeholder=f"새 {TAX_LABELS[lv]} 이름")
                chosen[lv] = val.strip()
                chosen["is_new_" + lv] = True
            else:
                chosen[lv] = pick
                chosen["is_new_" + lv] = False
    chosen["is_new_frame"] = chosen.get("is_new_frame", False)
    return chosen


def _ask_json(model, prompt):
    text = model.generate_content(prompt).text.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    try:
        return json.loads(m.group(0)) if m else {}
    except Exception:
        return {}


def classify_frame(problem_text, taxonomy, api_key, model_name):
    """문제를 학년 › 단원 › 유형 › 문제틀로 분류하고 난이도를 매긴다.
    유형표가 커져도 동작하도록 두 번에 나눠 고른다: ① 학년·단원·유형 ② 그 유형 안의 문제틀.
    기존 이름이 맞으면 그 글자 그대로 쓰고, 없으면 새 이름(+문제틀 설명)을 제안한다."""
    model = GeminiModel(api_key, model_name)

    types = []
    for t in taxonomy:
        key = (t.get("grade", ""), t.get("unit", ""), t.get("type", ""))
        if key not in types:
            types.append(key)
    type_lines = "\n".join(f"{i}. {g} | {u} | {ty}" for i, (g, u, ty) in enumerate(types[:2000]))
    step1 = _ask_json(model, f"""
    너는 대한민국 중·고등학교 수학 교육과정 전문가야. 아래 문제가 어느 학년·단원·유형인지 골라라.

    [문제]
    {problem_text}

    [기존 목록] (번호. 학년 | 단원 | 유형)
    {type_lines or "(아직 없음)"}

    [규칙]
    - 기존 목록에 맞는 것이 있으면 그 번호를 pick에 넣어라. 없으면 pick은 -1로 하고 새 이름을 만들어라.
    - 학년 예: 중1, 중2, 중3, 공통수학1, 공통수학2, 대수, 미적분I, 확률과 통계
    - 단원은 교과서 대단원/중단원 이름, 유형은 그 단원 안의 문제 유형(예: 방정식의 풀이, 활용 - 거리·속력·시간)
    - semester: 그 단원을 보통 배우는 학기 ("1학기" 또는 "2학기", 고등 선택과목처럼 학기 구분이 없으면 "공통")
    - 출력은 JSON 한 줄만: {{"pick": 번호 또는 -1, "grade": "...", "unit": "...", "type": "...", "semester": "..."}}
    """)
    pick = step1.get("pick", -1)
    try:
        pick = int(pick)
    except Exception:
        pick = -1
    if 0 <= pick < len(types):
        grade, unit, type_ = types[pick]
    else:
        grade, unit, type_ = (str(step1.get(k, "")).strip() for k in ("grade", "unit", "type"))

    frames = [t for t in taxonomy if (t.get("grade"), t.get("unit"), t.get("type")) == (grade, unit, type_)]
    frame_lines = "\n".join(f"{i}. {t.get('frame', '')} — {t.get('description', '')}" for i, t in enumerate(frames[:1000]))
    step2 = _ask_json(model, f"""
    너는 수학 문제 분류 전문가야. 아래 문제는 [{grade} › {unit} › {type_}] 유형이다.
    이 유형 안에서 "문제틀"을 골라라. 문제틀은 숫자나 난이도만 다르고 푸는 방법과 구조가 같은 문제들의 묶음이다.

    [문제]
    {problem_text}

    [기존 문제틀] (번호. 이름 — 설명)
    {frame_lines or "(아직 없음)"}

    [규칙]
    - 푸는 방법과 문제 구조가 같은 기존 문제틀이 있으면 그 번호를 pick에 넣어라. 없으면 pick은 -1.
    - 새로 만들 때 frame은 15자 안팎의 구체적인 이름, description은 "어떤 조건에서 무엇을 어떻게 구하는 문제인지" 한 문장.
    - difficulty는 이 문제의 난이도 (하/중/상 중 하나).
    - 출력은 JSON 한 줄만: {{"pick": 번호 또는 -1, "frame": "...", "description": "...", "difficulty": "중"}}
    """)
    fpick = step2.get("pick", -1)
    try:
        fpick = int(fpick)
    except Exception:
        fpick = -1
    if 0 <= fpick < len(frames):
        frame = frames[fpick].get("frame", "")
        description = frames[fpick].get("description", "")
        is_new = False
    else:
        frame = str(step2.get("frame", "")).strip()
        description = str(step2.get("description", "")).strip()
        is_new = True
    difficulty = str(step2.get("difficulty", "중")).strip()
    if difficulty not in DIFFICULTIES:
        difficulty = "중"
    semester = str(step1.get("semester", "")).strip()
    return {"grade": grade, "unit": unit, "type": type_, "frame": frame, "semester": semester if semester in SEMESTERS else "",
            "description": description, "difficulty": difficulty, "is_new_frame": is_new}


def mathpix_ocr(image_bytes):
    """사진에서 수식/글자 추출 (문제 만들기 탭과 같은 방식). 실패하면 빈 문자열."""
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    headers = {"app_id": mathpix_app_id, "app_key": mathpix_app_key, "Content-type": "application/json"}
    data = {"src": f"data:image/jpeg;base64,{b64}", "formats": ["text", "latex_styled"]}
    res = requests.post("https://api.mathpix.com/v3/text", headers=headers, json=data, timeout=60)
    text = res.json().get("text", "")
    text = re.sub(r'\\\(\s*', '$', text); text = re.sub(r'\s*\\\)', '$', text)
    text = re.sub(r'\\\[\s*', '$$', text); text = re.sub(r'\s*\\\]', '$$', text)
    return text


def make_problem_sheet_html(title, problems, with_answers=True):
    """문제 은행 문제들을 A4 학습지로 (한 쪽에 2문제, 맨 뒤에 정답)."""
    pages = ""
    for i in range(0, len(problems), 2):
        blocks = ""
        for j, p in enumerate(problems[i:i + 2], start=i + 1):
            blocks += f"""
            <div class="problem-container">
                <div class="prob-header">[{j}] <span class="tag">{p.get('frame', '')} · {p.get('difficulty', '')}</span></div>
                <div class="prob-body">{format_math(p.get('question', '')).replace(chr(10), '<br>')}</div>
                <div class="work-space"><span class="work-label">[풀이 과정]</span></div>
            </div>"""
        pages += f"""
        <div class="a4-page">
            <div class="header-box"><div class="header-title">📐 {title}</div>
            <div class="name-box">학년/반: ______ 이름: ______________</div></div>
            {blocks}
        </div>"""
    answers = ""
    if with_answers:
        for j, p in enumerate(problems, start=1):
            sol = format_math(p.get("solution", ""))
            answers += f"""<div style="margin-bottom:10px; font-size:13px; line-height:1.6; border-bottom:1px solid #eee; padding-bottom:6px;">
                <strong>[{j}] 정답:</strong> {format_math(p.get('answer', ''))}<br>{f'<strong>풀이:</strong> {sol}' if sol else ''}</div>"""
        answers = f'<div class="answer-page"><div class="header-box"><div class="header-title">📋 [정답 및 해설] {title}</div></div>{answers}</div>'
    return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>{title}</title>
<script>window.MathJax = {{ tex: {{ inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$', '$$']] }} }};</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
<style>
@page {{ size: A4 portrait; margin: 10mm 15mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #111; background: #fff; max-width: 820px; margin: 0 auto; padding: 10px; }}
.a4-page {{ page-break-after: always; height: 270mm; display: flex; flex-direction: column; overflow: hidden; }}
.header-box {{ text-align: center; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 8px; }}
.header-title {{ font-size: 18px; font-weight: bold; }}
.name-box {{ text-align: right; font-size: 13px; color: #444; }}
.problem-container {{ flex: 1 1 0; display: flex; flex-direction: column; border-bottom: 1px dashed #aaa; padding: 6px 0; }}
.problem-container:last-child {{ border-bottom: none; }}
.prob-header {{ font-weight: bold; font-size: 14.5px; margin-bottom: 4px; }}
.tag {{ font-weight: normal; font-size: 11px; color: #888; }}
.prob-body {{ line-height: 1.7; font-size: 13.5px; }}
.work-space {{ flex: 1 1 0; min-height: 80px; margin-top: 8px; border: 1px dotted #ccc; border-radius: 4px; padding: 6px 10px; }}
.work-label {{ font-size: 11.5px; color: #888; }}
.answer-page {{ page-break-before: always; }}
.print-btn-bar {{ text-align: center; margin-bottom: 15px; }}
@media print {{ .print-btn-bar {{ display: none; }} }}
</style></head><body>
<div class="print-btn-bar"><button onclick="window.print()" style="padding:10px 24px; font-size:15px;">🖨️ 인쇄하기 (A4)</button></div>
{pages}{answers}
</body></html>"""


def add_to_hw_cart(problems):
    """선생님이 고른 문제를 '숙제 바구니'에 담는다 (📝 숙제 탭에서 숙제로 낸다)."""
    cart = st.session_state.setdefault("hw_cart", [])
    store = st.session_state.setdefault("hw_cart_items", {})
    added = 0
    for p in problems:
        pid = p.get("id")
        if pid and pid not in cart:
            cart.append(pid)
            store[pid] = p
            added += 1
    st.success(f"숙제 바구니에 {added}문제를 담았어요. (지금 {len(cart)}문제) '📝 숙제' 탭에서 숙제로 내세요.")


def render_bank_problem(p, key_prefix, editable=True):
    """문제 은행 문제 1개: 문제, 정답·풀이, (선생님) 검수·수정·삭제."""
    badge = "✅ 검수 완료" if p.get("verified") == "Y" else "⏳ 검수 전"
    st.caption(f"{badge} · {p.get('source', '')} · 난이도 {p.get('difficulty', '')} · {p.get('created_at', '')[:10]}")
    if p.get("image_file_id") and st.checkbox("🖼️ 원본 사진 보기", key=f"{key_prefix}_img_{p.get('id')}"):
        img = archive_image(p["image_file_id"])
        if img:
            st.image(f"data:image/jpeg;base64,{img}", use_container_width=True)
    st.markdown(format_math(p.get("question", "")), unsafe_allow_html=True)
    with st.expander("🔍 정답 및 풀이"):
        st.markdown(f"**정답:** {format_math(p.get('answer', ''))}", unsafe_allow_html=True)
        if p.get("solution"):
            st.markdown(f"**풀이:**\n\n{format_math(p.get('solution', ''))}", unsafe_allow_html=True)
    if not editable:
        return
    pid = p.get("id")
    c1, c2, c3 = st.columns([1.2, 1.2, 1])
    with c1:
        if p.get("verified") == "Y":
            if st.button("검수 취소", key=f"{key_prefix}_unv_{pid}"):
                if bank_update(pid, verified=""):
                    st.rerun()
        else:
            if st.button("✅ 검수 완료로 표시", key=f"{key_prefix}_ver_{pid}"):
                if bank_update(pid, verified="Y"):
                    st.rerun()
    with c2:
        edit = st.checkbox("✏️ 수정", key=f"{key_prefix}_edit_{pid}")
    with c3:
        if st.checkbox("삭제 확인", key=f"{key_prefix}_delchk_{pid}"):
            if st.button("🗑️ 삭제", key=f"{key_prefix}_del_{pid}"):
                if bank_delete(pid):
                    st.rerun()
                else:
                    st.error(st.session_state.pop("bank_err", "삭제하지 못했어요."))
    if edit:
        q = st.text_area("문제", value=p.get("question", ""), key=f"{key_prefix}_q_{pid}", height=120)
        a = st.text_input("정답", value=p.get("answer", ""), key=f"{key_prefix}_a_{pid}")
        s = st.text_area("풀이", value=p.get("solution", ""), key=f"{key_prefix}_s_{pid}", height=100)
        d = st.selectbox("난이도", DIFFICULTIES, index=DIFFICULTIES.index(p.get("difficulty")) if p.get("difficulty") in DIFFICULTIES else 1,
                         key=f"{key_prefix}_d_{pid}")
        st.markdown("문제틀 옮기기")
        moved = taxonomy_picker(f"{key_prefix}_mv_{pid}", taxonomy_list(), suggestion=p)
        if st.button("💾 저장", key=f"{key_prefix}_save_{pid}"):
            fields = dict(question=q, answer=a, solution=s, difficulty=d)
            if all(moved.get(lv) for lv in TAX_LEVELS):
                fields.update({lv: moved[lv] for lv in TAX_LEVELS})
            if bank_update(pid, **fields):
                st.success("저장했습니다.")
                st.rerun()
            else:
                st.error("저장에 실패했습니다.")


def type_label(t):
    parts = [t.get("grade", ""), t.get("unit", ""), t.get("subtype", "")]
    return " › ".join(x for x in parts if x) or "(유형 미지정)"


def classify_problem(ocr_text, existing_types, api_key, model_name):
    """원본 문제를 보고 학년 › 단원 › 세부 유형을 제안. 기존 유형과 같으면 그 이름을 그대로 쓰게 한다."""
    model = GeminiModel(api_key, model_name)
    existing_lines = "\n".join(f"- {t.get('grade', '')} | {t.get('unit', '')} | {t.get('subtype', '')}" for t in existing_types[:200])
    prompt = f"""
    너는 대한민국 중·고등학교 수학 교육과정 전문가야. 아래 문제의 유형을 분류하라.

    [문제]
    {ocr_text}

    [분류 규칙]
    - grade: 학년 (예: 중1, 중2, 중3, 고1, 수학I, 수학II, 미적분, 확률과 통계, 기하)
    - unit: 교과서 단원 이름 (예: 일차방정식, 정수와 유리수, 이차함수, 수열의 극한)
    - subtype: 그 단원 안의 자세한 문제 유형 (예: 등식의 성질 찾기, 계수가 분수인 일차방정식 풀기)
    - 아래 [기존 유형 목록]에 같은 유형이 있으면 반드시 그 글자 그대로 사용하라. 없을 때만 새 이름을 만들어라.

    [기존 유형 목록] (학년 | 단원 | 세부 유형)
    {existing_lines or "(아직 없음)"}

    [출력] 다른 말 없이 JSON 한 줄만 출력하라:
    {{"grade": "...", "unit": "...", "subtype": "..."}}
    """
    res = model.generate_content(prompt)
    text = res.text.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    try:
        obj = json.loads(m.group(0)) if m else {}
    except Exception:
        obj = {}
    return {
        "grade": str(obj.get("grade", "")).strip(),
        "unit": str(obj.get("unit", "")).strip(),
        "subtype": str(obj.get("subtype", "")).strip(),
    }


# ==========================================
# ★ 보안 수정: HTML 살균(sanitize) 엔진
# 구글 시트에서 온 데이터를 그대로 unsafe_allow_html=True로 렌더링하면
# 악성 스크립트가 저장되어 있을 경우 그대로 실행되는 위험(저장형 XSS)이 있음.
# <script>, onclick 같은 이벤트 핸들러, <iframe>, javascript: 링크처럼
# 명백히 위험한 패턴만 정확히 찾아서 제거하고, 그 외 텍스트(수식의 <, >, &
# 등)는 전혀 건드리지 않는다. format_math() 마지막 단계에서 항상 거치도록
# 연결되어 있어서 이 함수를 거치는 모든 화면(게시판, 생성 결과, 인쇄용
# 파일)이 한 번에 보호된다.
# ==========================================
# 위험한 블록형 태그(내용까지 통째로 제거): script, style, iframe 등
_DANGEROUS_BLOCK = re.compile(
    r'<\s*(script|style|iframe|object|embed|link|meta|form)\b[^>]*>.*?<\s*/\s*\1\s*>',
    re.IGNORECASE | re.DOTALL
)
# 위 태그들의 자기닫힘/짝없는 형태 + img, input 등 나머지 위험 태그
_DANGEROUS_SELFCLOSING = re.compile(
    r'<\s*/?\s*(script|style|iframe|object|embed|link|meta|form|input|button|textarea|select|base|img)\b[^>]*/?\s*>',
    re.IGNORECASE
)
# onclick, onerror, onload 등 이벤트 핸들러 속성 (어떤 태그에 붙어있든 전부 제거)
_EVENT_HANDLER = re.compile(r'\s+on[a-zA-Z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)', re.IGNORECASE)
# href/src 계열 속성 (이 앱의 정상 출력물은 이 속성들이 전혀 필요 없으므로 통째로 제거)
_HREF_SRC = re.compile(r'\s+(?:href|src|xlink:href|formaction|action)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)', re.IGNORECASE)
_JS_IN_STYLE_DQ = re.compile(r'style\s*=\s*"([^"]*)"', re.IGNORECASE)
_JS_IN_STYLE_SQ = re.compile(r"style\s*=\s*'([^']*)'", re.IGNORECASE)
_JS_PATTERN = re.compile(r'expression\s*\(|javascript\s*:', re.IGNORECASE)


def sanitize_html(text):
    """<script>, <iframe>, 이벤트 핸들러(onclick 등), javascript: 링크처럼
    명확히 위험한 패턴만 제거하고 나머지(수식 기호 <, >, & 포함)는 그대로 둔다.
    (전체를 화이트리스트 태그 파서로 걸렀더니 'x<y'처럼 부등호 뒤에 글자가
    바로 오는 정상 수식까지 태그로 오인해서 텍스트가 통째로 사라지는 문제가
    있어, 위험 패턴만 콕 집어 제거하는 방식으로 변경함)
    """
    if not text:
        return text
    prev = None
    # <scr<script>ipt> 같은 중첩 우회 시도까지 방어하기 위해 변화 없을 때까지 반복 적용
    while prev != text:
        prev = text
        text = _DANGEROUS_BLOCK.sub('', text)
        text = _DANGEROUS_SELFCLOSING.sub('', text)
    text = _EVENT_HANDLER.sub('', text)
    text = _HREF_SRC.sub('', text)
    text = _JS_IN_STYLE_DQ.sub(lambda m: '' if _JS_PATTERN.search(m.group(1)) else m.group(0), text)
    text = _JS_IN_STYLE_SQ.sub(lambda m: '' if _JS_PATTERN.search(m.group(1)) else m.group(0), text)
    return text


# ==========================================
# ★ 수식 렌더링, 전개도 맞춤 표, SVG 통합 엔진
# ==========================================
def convert_frac_to_html(text):
    """분수(\frac{a}{b})를 HTML 세로 분수로 변환하여 표/셀 내부 깨짐 방지"""
    def repl(m):
        sign = m.group(1) or ""
        num = m.group(2).strip()
        den = m.group(3).strip()
        return f'{sign}<span style="display:inline-flex; flex-direction:column; vertical-align:middle; text-align:center; font-size:12px; line-height:1.1; margin:0 2px;"><span style="border-bottom:1.5px solid #111; padding:0 1px;">{num}</span><span>{den}</span></span>'
    pattern = r'([+-]?)\s*\\frac\{([^{}]+)\}\{([^{}]+)\}'
    return re.sub(pattern, repl, text)

def _clean_cell(col):
    """표 내부 셀의 불필요한 달러 기호($) 제거 및 분수 HTML 렌더링 지원"""
    col = col.strip()
    if col.startswith('$') and col.endswith('$'):
        col = col[1:-1].strip()
    col = convert_frac_to_html(col)
    col = col.replace('$', '')
    return col

def _md_table_to_html(lines):
    if not lines:
        return ""
    rows = []
    for line in lines:
        if re.match(r'^\|(?:\s*:?-+:?\s*\|)+$', line):
            continue
        cols = [c.strip() for c in line.strip('|').split('|')]
        rows.append(cols)
    if not rows:
        return ""
    
    has_empty = any(_clean_cell(c) == '' for row in rows for c in row)
    
    if has_empty:
        html = '<div style="margin: 12px 0; overflow-x: auto;"><table style="border-collapse: collapse; margin: 0 auto; text-align: center; font-size: 14.5px;">'
        for row in rows:
            html += '<tr>'
            for col in row:
                cleaned_col = _clean_cell(col)
                if not cleaned_col:
                    html += '<td style="border: none; width: 44px; height: 44px; padding: 2px; background: transparent;"></td>'
                else:
                    html += f'<td style="border: 2px solid #222222; width: 44px; height: 44px; padding: 4px; background-color: #ffffff; font-weight: bold; color: #111111; text-align: center; vertical-align: middle; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">{cleaned_col}</td>'
            html += '</tr>'
        html += '</table></div>'
        return html
    else:
        html = '<div style="margin: 10px 0; overflow-x: auto;"><table style="border-collapse: collapse; margin: 0 auto; text-align: center; font-size: 13.5px; border: 1px solid #777;">'
        for i, row in enumerate(rows):
            html += '<tr>'
            for col in row:
                cleaned_col = _clean_cell(col)
                bg = '#f1f3f5' if i == 0 else '#ffffff'
                fw = 'bold' if i == 0 else 'normal'
                html += f'<td style="border: 1px solid #777; padding: 5px 12px; background-color: {bg}; font-weight: {fw}; color: #111111;">{cleaned_col}</td>'
            html += '</tr>'
        html += '</table></div>'
        return html

def format_math(text):
    if not text:
        return ""
    text = str(text)
    
    # 0. SVG가 마크다운 코드블록(```html ... ```)에 감싸져 있는 경우 자동 해제
    text = re.sub(r'```(?:html|xml|svg)?\s*(<svg[\s\S]*?<\/svg>)\s*```', r'\1', text)
    
    # 0-1. OCR 기호 오인식 정제
    text = text.replace(r'\neg', 'ㄱ').replace(r'\llcorner', 'ㄴ')
    text = re.sub(r'\{\s*\(\s*ㄱ\s*\)\s*\(\s*ㄴ\s*\)\s*\}*', '㉠ ㉡', text)
    text = re.sub(r'\(\s*ㄱ\s*\)', '㉠', text)
    text = re.sub(r'\(\s*ㄴ\s*\)', '㉡', text)
    text = re.sub(r'\(\s*ㄷ\s*\)', '㉢', text)
    text = re.sub(r'\(\s*ㄹ\s*\)', '㉣', text)
    
    # 1. 줄바꿈 기호 변환
    text = text.replace('[br]', '\n\n')
    text = re.sub(r'\$([a-zA-Z0-9])\$\s*(모둠|반|팀|그룹|등|점|명|개|권|초|분|시간|원|cm|m)', r'\1 \2', text)
    text = re.sub(r'\$([a-zA-Z])\$', r'\1', text)
    
    # 2. LaTeX \begin{tabular} 표를 깔끔한 HTML 표로 변환
    def replace_tabular(match):
        content = match.group(1)
        content = content.replace(r'\hline', '')
        rows = [r.strip() for r in content.split(r'\\') if r.strip()]
        if not rows:
            return ""
        html = '<div style="margin: 10px 0; overflow-x: auto;"><table style="border-collapse: collapse; margin: 0 auto; text-align: center; font-size: 13.5px; border: 1px solid #777;">'
        for i, row in enumerate(rows):
            cols = [c.strip() for c in row.split('&')]
            html += '<tr>'
            for col in cols:
                cleaned_col = _clean_cell(col)
                bg = '#f1f3f5' if i == 0 else '#ffffff'
                fw = 'bold' if i == 0 else 'normal'
                html += f'<td style="border: 1px solid #777; padding: 5px 12px; background-color: {bg}; font-weight: {fw}; color: #111111;">{cleaned_col}</td>'
            html += '</tr>'
        html += '</table></div>'
        return html
    pattern_tab = r'\\begin\{tabular\}(?:\[[^\]]*\])?(?:\{[^\}]*\})([\s\S]*?)\\end\{tabular\}'
    text = re.sub(pattern_tab, replace_tabular, text)
    
    # 3. 마크다운 표(|...|)를 HTML 표로 변환
    lines = text.split('\n')
    new_lines = []
    table_lines = []
    in_table = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('|') and stripped.endswith('|'):
            table_lines.append(stripped)
            in_table = True
        else:
            if in_table:
                new_lines.append(_md_table_to_html(table_lines))
                table_lines = []
                in_table = False
            new_lines.append(line)
    if in_table:
        new_lines.append(_md_table_to_html(table_lines))
    text = '\n'.join(new_lines)

    # 4. Mathpix $$...$$ 블록 정규화
    text = re.sub(r'\$\$(.*?)\$\$', r'$\1$', text, flags=re.DOTALL)
    
    # 5. 빈칸 문자 및 기호 박스화 자동 변환
    text = re.sub(r'[□■]\s*\(([가-힣a-zA-Z0-9]+)\)', r'$\boxed{\text{ (\1) }}$', text)
    text = re.sub(r'\[\s*\(([가-힣a-zA-Z0-9]+)\)\s*\]', r'$\boxed{\text{ (\1) }}$', text)
    
    # 6. 명령어 앞 중복 백슬래시 정리
    text = re.sub(r'\\\\([a-zA-Z{}])', r'\\\1', text)
    text = re.sub(r'\\\\([a-zA-Z{}])', r'\\\1', text)
    
    # 7. 도형 및 극한 기호 정규화
    text = re.sub(r'\\mathrm\{([A-Z]+)\}', r'\1', text)
    text = re.sub(r'lim_?\{?xtoa\}?', r'\\lim\\limits_{x \\to a} ', text)
    text = re.sub(r'lim_?\{?x\s*to\s*([a-zA-Z0-9]+)\}?', r'\\lim\\limits_{x \\to \1} ', text)
    text = re.sub(r'\\lim\s*its', r'\\lim\\limits', text)
    text = re.sub(r'\\lim(?![a-zA-Z])(?!\s*\\limits)', r'\\lim\\limits', text)
    text = re.sub(r'(\\lim\\limits\s*)+', r'\\lim\\limits ', text)
    
    text = re.sub(r'\bfrac([0-9])([0-9])\b', r'\\frac{\1}{\2}', text)
    text = re.sub(r'\bfracf\(x\)g\(x\)', r'\\frac{f(x)}{g(x)}', text)
    text = re.sub(r'\bfracg\(x\)f\(x\)', r'\\frac{g(x)}{f(x)}', text)
    text = re.sub(r'(?<!\\)\bfrac\{', r'\\frac{', text)
    text = text.replace('\x0c', r'\f').replace('♀rac', r'\frac').replace('♀', r'\f')
    text = text.replace('\x08', r'\b').replace('\x07', r'\a').replace('\x0b', r'\v')
    text = re.sub(r'(\b[a-zA-Z]\b)\s+o\s+(\d+|[a-zA-Z])', r'\1 \\to \2', text)
    text = re.sub(r'\bight\b', r'\\right', text)
    
    # 8. $ 기호 없이 노출된 수식 자동 감싸기 (HTML 태그 보호)
    parts = text.split('$')
    new_parts = []
    for i, part in enumerate(parts):
        if i % 2 == 0:
            if '<svg' not in part and '<table' not in part:
                def replacer(match):
                    chunk = match.group(1).rstrip()
                    if not chunk:
                        return ""
                    return f"${chunk}$"
                pattern = r'(\\[a-zA-Z]+(?:\{[^{}]*\}|[\w\s+\-*/=<>(),._\^\\{}]*?))(?=[가-힣\n\r<]|$)'
                part = re.sub(pattern, replacer, part)
                part = re.sub(r'(?<![$\\])\b([fgh]\'?\([a-zA-Z\d+\-*/]*\))(?![$\\])', r'$\1$', part)
        new_parts.append(part)
    
    text = '$'.join(new_parts)
    text = re.sub(r'\$\s*\$', '', text)
    text = re.sub(r'\${3,}', '$$', text)
    
    # 9. 카드 UI 변환
    def render_cards(match):
        items = [x.strip() for x in match.group(1).split(',') if x.strip()]
        card_html = '<div style="display:inline-flex; gap:8px; margin:8px 0; align-items:center; vertical-align:middle;">'
        for item in items:
            card_html += f'<div style="min-width:32px; height:46px; padding:2px 8px; border:2px solid #333; border-radius:6px; background-color:#ffffff; color:#111111; font-weight:bold; font-size:16px; display:inline-flex; align-items:center; justify-content:center; box-shadow:1px 2px 4px rgba(0,0,0,0.12);">{item}</div>'
        card_html += '</div>'
        return card_html
    text = re.sub(r'\[카드\s*:\s*([^\]]+)\]', render_cards, text)
    
    # 10. 수직선/겨냥도/그래프/도형 SVG 다이어그램 흰색 카드 박스 감싸기
    def wrap_svg_card(match):
        svg_content = match.group(0)
        return f'<div style="text-align: center; margin: 12px 0;"><div style="display: inline-block; background-color: #ffffff; padding: 10px 14px; border-radius: 8px; border: 1px solid #d0d0d0; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">{svg_content}</div></div>'
    text = re.sub(r'(<svg[\s\S]*?<\/svg>)', wrap_svg_card, text)
    
    # ★ 보안 수정: 최종 출력 직전에 항상 화이트리스트 살균을 거친다.
    # 이 함수를 거치는 모든 화면(게시판, 생성 결과, 인쇄용 파일)이 한 번에 보호됨.
    return sanitize_html(text)

def parse_date_group(date_str):
    if not date_str:
        return "9999-99-99", "날짜 미상"
    date_str = str(date_str).strip()

    month_map = {
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
    }
    
    eng_match = re.search(r'([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})', date_str)
    if eng_match:
        mon_str, d, y = eng_match.groups()
        m = month_map.get(mon_str.capitalize(), None)
        if m:
            date_key = f"{y}-{int(m):02d}-{int(d):02d}"
            date_label = f"{int(m)}월 {int(d)}일"
            return date_key, date_label

    match = re.search(r'(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})', date_str)
    if match:
        y, m, d = match.groups()
        date_key = f"{y}-{int(m):02d}-{int(d):02d}"
        date_label = f"{int(m)}월 {int(d)}일"
        return date_key, date_label

    match_kor = re.search(r'(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일', date_str)
    if match_kor:
        y, m, d = match_kor.groups()
        y = y if y else "2026"
        date_key = f"{y}-{int(m):02d}-{int(d):02d}"
        date_label = f"{int(m)}월 {int(d)}일"
        return date_key, date_label

    return date_str, date_str

def parse_single_problem(res_text, prob_num):
    q_match = re.search(r'\[문제\]([\s\S]*?)(?=\[정답\]|$)', res_text)
    a_match = re.search(r'\[정답\]([\s\S]*?)(?=\[풀이\]|$)', res_text)
    s_match = re.search(r'\[풀이\]([\s\S]*?)$', res_text)
    
    return {
        "problem_num": prob_num,
        "question": q_match.group(1).strip() if q_match else res_text.strip(),
        "answer": a_match.group(1).strip() if a_match else "",
        "solution": s_match.group(1).strip() if s_match else ""
    }

# ==========================================
# ★ 병렬 단일 문제 생성기 (방정식 옆 곡선 화살표 지원)
# ==========================================
def generate_one_problem_async(prob_type, prob_num, ocr_text, solution_instruction, api_key, model_name):
    model = GeminiModel(api_key, model_name)
    
    if prob_num == 1:
        type_instruction = """
        [1번 기본 다지기 출제 원칙]
        - 원본 문제의 형태와 구조를 그대로 유지하되, **반드시 원본에 주어진 숫자(예: 계수, 상수 등)를 다른 수치로 확실하게 변경**하여 1문제를 출제하라.
        """
    else:
        type_instruction = """
        [2번 실력 키우기 출제 원칙 (1번과 절대 중복 금지!)]
        - 1번과 똑같은 단순 숫자 변경 문제를 만들지 마라!
        - 같은 단원 개념을 사용하되, 반드시 **'다른 등식의 성질을 묻기'**, **'괄호나 소수/분수가 포함된 1단계 더 발전된 방정식'**, 또는 **'역방향 계산'**으로 1번과 완전히 차별화하여 1문제를 출제하라.
        """

    prompt = f"""
    너는 대한민국 중학교/고등학교 수학 출제 위원이야. 원본 문제를 바탕으로 [{prob_type}]를 1개만 제작하라.

    [원본 문제]
    {ocr_text}

    {type_instruction}

    [공통 그래픽/수식 규칙 (속도 최우선)]
    1. **방정식 풀이 과정 / 등식의 성질 (오른쪽 곡선 화살표 ㉠, ㉡, ㉢) 표기 규칙 (매우 중요):**
       - 원본 문제가 '방정식 풀이 과정 중 등식의 성질 ㉠, ㉡, ㉢ 찾기' 유형인 경우, **마크다운 코드블록(```)을 절대 쓰지 말고 아래와 같이 순수 SVG 태그(`<svg ...>...</svg>`)로 직접 출력**하라:
         <svg width="220" height="155" viewBox="0 0 220 155">
           <rect x="5" y="5" width="210" height="145" rx="10" fill="#ffffff" stroke="#aaaaaa" stroke-width="1.5"/>
           <text x="75" y="32" font-size="14" font-weight="bold" fill="#000000" text-anchor="middle">1단계 식</text>
           <text x="75" y="68" font-size="14" font-weight="bold" fill="#000000" text-anchor="middle">2단계 식</text>
           <text x="75" y="104" font-size="14" font-weight="bold" fill="#000000" text-anchor="middle">3단계 식</text>
           <text x="75" y="138" font-size="14" font-weight="bold" fill="#000000" text-anchor="middle">∴ x = 값</text>
           <path d="M 130,28 C 160,30 160,62 135,66" fill="none" stroke="#222222" stroke-width="1.5"/>
           <polygon points="135,66 142,61 141,71" fill="#222222"/>
           <text x="168" y="51" font-size="13" font-weight="bold" fill="#000000">㉠</text>
           <path d="M 130,68 C 160,70 160,98 135,102" fill="none" stroke="#222222" stroke-width="1.5"/>
           <polygon points="135,102 142,97 141,107" fill="#222222"/>
           <text x="168" y="89" font-size="13" font-weight="bold" fill="#000000">㉡</text>
           <path d="M 130,104 C 160,106 160,132 135,136" fill="none" stroke="#222222" stroke-width="1.5"/>
           <polygon points="135,136 142,131 141,141" fill="#222222"/>
           <text x="168" y="123" font-size="13" font-weight="bold" fill="#000000">㉢</text>
         </svg>
    2. **도형/그래프/수직선 SVG 초경량 작성:**
       - 도형이 필요한 경우 6~8줄 이내의 초간단 인라인 SVG(`<svg width="220" height="130" viewBox="0 0 220 130">...</svg>`)로 작성하라.
       - 모든 SVG 텍스트는 `fill="#000000"`으로 작성하라.
    2-1. **좌표평면(점의 좌표, 그래프 위 점 찍기 등) 문제 전용 규칙:**
       - 반드시 아래 예시처럼 `<pattern>`으로 연한 회색 격자를 배경 전체에 채우고, 그 위에 x축/y축(화살표 포함)과 점들을 검은색으로 찍어라. 격자 눈금 간격은 20으로 고정한다:
         <svg width="200" height="200" viewBox="0 0 200 200">
           <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#dddddd" stroke-width="1"/></pattern></defs>
           <rect width="200" height="200" fill="url(#g)"/>
           <line x1="0" y1="100" x2="200" y2="100" stroke="#000000" stroke-width="1.5"/>
           <line x1="100" y1="0" x2="100" y2="200" stroke="#000000" stroke-width="1.5"/>
           <polygon points="200,100 193,96 193,104" fill="#000000"/>
           <polygon points="100,0 96,7 104,7" fill="#000000"/>
           <text x="205" y="104" font-size="12" fill="#000000">x</text>
           <text x="104" y="10" font-size="12" fill="#000000">y</text>
           <circle cx="120" cy="80" r="3" fill="#000000"/><text x="124" y="76" font-size="12" fill="#000000">A</text>
         </svg>
       - 점의 좌표는 격자 눈금(20 간격) 위에만 찍어라. 점과 라벨(A, B, C...) 외의 불필요한 장식은 넣지 마라.
    3. **정육면체 겨냥도/전개도:**
       - 3D 겨냥도는 3면 큐브 SVG로, 펼쳐진 전개도는 3x4 마크다운 격자 표로 작성하라.
    4. **수식 표기:** 지문 본문에서 단순 문자(A, B, C, 보기 ㄱ, ㄴ, ㄷ 등)에는 $를 쓰지 말고, 분수식/계산식만 `$수식$`으로 작성하라.

    [출력 양식]
    [문제]
    (문제 지문 및 SVG)
    [정답]
    (정답)
    [풀이]
    ({solution_instruction})
    """
    
    res = model.generate_content(prompt)
    return parse_single_problem(res.text.strip(), prob_num)

# ==========================================
# ★ A4 규격 인쇄용 HTML 생성기 (상하 50:50 균등 분할)
# ==========================================
def make_printable_html(title, items):
    html_pages = ""
    ans_items = ""
    
    for idx, p in enumerate(items, start=1):
        q1 = format_math(p.get("q1", "")).replace('\n', '<br>')
        q2 = format_math(p.get("q2", "")).replace('\n', '<br>')
        a1 = format_math(p.get("a1", ""))
        s1 = format_math(p.get("s1", ""))
        a2 = format_math(p.get("a2", ""))
        s2 = format_math(p.get("s2", ""))
        
        img_tag = ""
        if p.get("image_b64"):
            img_tag = f'<div style="text-align:center; margin: 4px 0;"><img src="data:image/jpeg;base64,{p["image_b64"]}" style="max-height:85px; max-width:80%; border:1px solid #ddd; border-radius:4px;"></div>'

        set_title = f"{title} (과제 세트 {idx})" if len(items) > 1 else title

        html_pages += f"""
        <div class="a4-page">
            <div class="header-box">
                <div class="header-title">📐 {set_title}</div>
                <div class="name-box">학년/반: ______ 이름: ______________</div>
            </div>
            {img_tag}
            <div class="problem-container">
                <div class="prob-header">[문제 1] 기본 다지기</div>
                <div class="prob-body">{q1}</div>
                <div class="work-space">
                    <span class="work-label">[풀이 과정]</span>
                </div>
            </div>
            <div class="problem-container">
                <div class="prob-header">[문제 2] 실력 키우기</div>
                <div class="prob-body">{q2}</div>
                <div class="work-space">
                    <span class="work-label">[풀이 과정]</span>
                </div>
            </div>
        </div>
        """
        
        ans_items += f"""
        <div class="answer-card" style="margin-bottom: 15px; font-size:13px; line-height:1.6; border-bottom: 1px solid #eee; padding-bottom: 8px;">
            <div style="font-weight:bold; margin-bottom:4px; color:#1976d2;">📌 과제 세트 {idx}</div>
            <strong>[문제 1] 정답:</strong> {a1}<br>
            {f'<strong>풀이:</strong> {s1}<br>' if s1 else ''}
            <div style="margin-top:4px;"></div>
            <strong>[문제 2] 정답:</strong> {a2}<br>
            {f'<strong>풀이:</strong> {s2}' if s2 else ''}
        </div>
        """

    full_html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <script>
        window.MathJax = {{
            tex: {{
                inlineMath: [['$', '$'], ['\\(', '\\)']],
                displayMath: [['$$', '$$'], ['\\[', '\\]']]
            }},
            svg: {{ fontCache: 'global' }}
        }};
    </script>
    <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
    <style>
        @page {{ 
            size: A4 portrait; 
            margin: 10mm 15mm; 
        }}
        * {{ box-sizing: border-box; }}
        body {{ 
            font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕', sans-serif; 
            color: #111; 
            background: #ffffff; 
            margin: 0; 
            padding: 10px;
            max-width: 820px;
            margin: 0 auto;
        }}
        
        .a4-page {{
            page-break-after: always;
            break-after: page;
            height: 270mm;
            max-height: 270mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
            margin-bottom: 20px;
            background: #fff;
        }}
        
        .header-box {{ 
            flex-shrink: 0;
            text-align: center; 
            border-bottom: 2px solid #000; 
            padding-bottom: 5px; 
            margin-bottom: 8px; 
        }}
        .header-title {{ font-size: 18px; font-weight: bold; margin-bottom: 3px; }}
        .name-box {{ text-align: right; font-size: 13px; font-weight: 500; color: #444; }}
        
        .problem-container {{
            flex: 1 1 0;
            display: flex;
            flex-direction: column;
            border-bottom: 1px dashed #aaa;
            padding-top: 6px;
            padding-bottom: 6px;
            margin-bottom: 6px;
        }}
        .problem-container:last-child {{
            border-bottom: none;
            margin-bottom: 0;
        }}
        
        .prob-header {{
            flex-shrink: 0;
            font-weight: bold;
            font-size: 14.5px;
            color: #000;
            margin-bottom: 4px;
        }}
        .prob-body {{
            flex-shrink: 0;
            line-height: 1.7;
            font-size: 13.5px;
            color: #111;
        }}
        
        .work-space {{
            flex: 1 1 0;
            min-height: 80px;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            margin-top: 8px;
            background: #fafafa;
            border: 1px dotted #ccc;
            border-radius: 4px;
            padding: 6px 10px;
        }}
        .work-label {{
            font-size: 11.5px;
            color: #888;
        }}
        
        .answer-page {{
            page-break-before: always;
            break-before: page;
            padding-top: 10px;
        }}
        
        .print-btn-bar {{
            text-align: center;
            margin-bottom: 15px;
            padding: 10px;
            background: #f0f4f8;
            border-radius: 8px;
        }}
        .btn {{
            background: #1976d2;
            color: white;
            border: none;
            padding: 10px 24px;
            font-size: 15px;
            font-weight: bold;
            border-radius: 6px;
            cursor: pointer;
        }}
        .btn:hover {{ background: #115293; }}
        @media print {{
            .print-btn-bar {{ display: none !important; }}
            body {{ padding: 0; max-width: 100%; }}
            .a4-page {{ 
                margin-bottom: 0; 
                height: 272mm;
            }}
            .work-space {{ background: transparent; border-color: #bbb; }}
        }}
    </style>
</head>
<body>
    <div class="print-btn-bar">
        <button class="btn" onclick="window.print()">🖨️ 이 시험지 지금 바로 인쇄하기 (A4)</button>
        <div style="font-size:12px; color:#666; margin-top:6px;">※ 수식이 모두 로드된 후 인쇄 버튼을 누르시면 깨끗하게 출력됩니다.</div>
    </div>
    
    {html_pages}
    
    <div class="answer-page">
        <div class="header-box">
            <div class="header-title" style="font-size:18px;">📋 [정답 및 해설] {title}</div>
        </div>
        {ans_items}
    </div>
</body>
</html>"""
    return full_html

def render_personal_item(p, student_id):
    """개인 보관함(내 보관함) 화면에서 문제 하나를 카드 형태로 표시."""
    with st.container():
        label = "🖊️ 내가 만든 문제" if p.get("source") == "self" else "🔖 게시판에서 저장한 문제"
        st.markdown(f"##### {label} · 📅 {p.get('date', '')}")

        if p.get("image_b64"):
            st.image(f"data:image/jpeg;base64,{p['image_b64']}", use_container_width=True)

        q1_safe = format_math(p.get("q1", ""))
        a1_safe = format_math(p.get("a1", ""))
        s1_safe = format_math(p.get("s1", ""))
        q2_safe = format_math(p.get("q2", ""))
        a2_safe = format_math(p.get("a2", ""))
        s2_safe = format_math(p.get("s2", ""))

        st.markdown("#### [문제 1] 기본 다지기")
        st.markdown(q1_safe, unsafe_allow_html=True)
        with st.expander("🔍 1번 정답 및 풀이 확인"):
            st.markdown(f"**정답:** {a1_safe}", unsafe_allow_html=True)
            if s1_safe:
                st.markdown(f"**풀이:**\n\n{s1_safe}", unsafe_allow_html=True)

        st.markdown("#### [문제 2] 실력 키우기")
        st.markdown(q2_safe, unsafe_allow_html=True)
        with st.expander("🔍 2번 정답 및 풀이 확인"):
            st.markdown(f"**정답:** {a2_safe}", unsafe_allow_html=True)
            if s2_safe:
                st.markdown(f"**풀이:**\n\n{s2_safe}", unsafe_allow_html=True)

        if st.button("🗑️ 보관함에서 삭제", key=f"del_personal_{p.get('id')}"):
            if delete_personal_problem(student_id, p.get("id")):
                st.success("삭제했습니다!")
                time.sleep(0.3)
                st.rerun()
            else:
                st.error("삭제에 실패했습니다.")
    st.divider()

# ==========================================
# ★ 모델 설정
# ==========================================
# Secrets에 GEMINI_MODEL을 넣으면 그 모델로 고정된다(예: gemini-3.7-flash).
# 비워 두면 gemini-flash-latest를 써서, 구글이 새 Flash를 내놓을 때마다 자동으로 최신 모델을 쓴다.
DEFAULT_GEMINI_MODEL = "gemini-flash-latest"


def get_gemini_model_name():
    return (st.secrets.get("GEMINI_MODEL", "") or DEFAULT_GEMINI_MODEL).strip()


class GeminiModel:
    """google-genai SDK를 예전 GenerativeModel처럼 쓰기 위한 얇은 감싸개."""

    def __init__(self, api_key, model_name):
        self.client = genai.Client(api_key=api_key)
        self.model_name = model_name

    def generate_content(self, prompt):
        return self.client.models.generate_content(model=self.model_name, contents=prompt)

# ==========================================
# ★ 반 이름 설정 (1M2, 1M3, 2M1, 2M3, 3M1, 3M3)
# ==========================================
# ★ 수정: Secrets에 ADMIN_PASSWORD가 없으면 기본값(1234)으로 열리지 않도록 빈 값 처리
admin_pw = st.secrets.get("ADMIN_PASSWORD", "").strip()
class_list = ["1M2", "1M3", "2M1", "2M3", "3M1", "3M3"]

mathpix_app_id = st.secrets.get("MATHPIX_APP_ID", "")
mathpix_app_key = st.secrets.get("MATHPIX_APP_KEY", "")
gemini_api_key = st.secrets.get("GEMINI_API_KEY", "")

# ★ 수정: 반 공용 비밀번호 대신 학생 개인 계정(아이디+비밀번호) 시스템으로 전환.
# 로그인 상태는 세션에 저장해서, 매번 다시 입력하지 않아도 유지됩니다.
if "auth_role" not in st.session_state:
    st.session_state.auth_role = None       # "admin" / "미배정" / 실제 반 이름(예: "1M2")
if "auth_student_id" not in st.session_state:
    st.session_state.auth_student_id = None  # 학생일 때만 값이 있음 (관리자는 None)

# ==========================================
# ★ 새로고침해도 로그인 유지
# Streamlit은 새로고침하면 세션이 새로 시작되므로, 로그인할 때 서명된 "로그인 표"를
# 주소창(?s=...)에 붙여 두고, 새로고침 때 그 표를 확인해서 로그인 상태를 되살린다.
# 표는 Secrets 값으로 서명하므로 위조할 수 없고, ADMIN_PASSWORD를 바꾸면 모든 표가 무효가 된다.
# ==========================================
LOGIN_TTL_ADMIN = 2 * 3600         # 선생님: 2시간 (주소를 공유하거나 화면에 띄워도 피해가 오래가지 않게 짧게)
LOGIN_TTL_STUDENT = 7 * 24 * 3600  # 학생: 7일

_login_key_src = st.secrets.get("LOGIN_SECRET", "") or (sheet_api_token + "|" + admin_pw + "|" + password_salt)
_login_key = hashlib.sha256(("login|" + _login_key_src).encode("utf-8")).digest() if _login_key_src.strip("|") else b""


def _sign_login(payload_b64):
    return hmac.new(_login_key, payload_b64.encode("ascii"), hashlib.sha256).hexdigest()[:32]


def save_login_token(role, student_id):
    if not _login_key:
        return
    ttl = LOGIN_TTL_ADMIN if role == "admin" else LOGIN_TTL_STUDENT
    payload = json.dumps({"r": role, "u": student_id or "", "e": int(time.time()) + ttl}, ensure_ascii=False)
    payload_b64 = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")
    st.query_params["s"] = f"{payload_b64}.{_sign_login(payload_b64)}"


def clear_login_token():
    if "s" in st.query_params:
        del st.query_params["s"]


def restore_login_from_token():
    token = st.query_params.get("s", "")
    if not token or not _login_key or "." not in token:
        return
    payload_b64, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign_login(payload_b64)):
        clear_login_token()
        return
    try:
        data = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)).decode("utf-8"))
    except Exception:
        clear_login_token()
        return
    if int(data.get("e", 0)) < time.time():
        clear_login_token()
        return
    role = data.get("r") or None
    student_id = data.get("u") or None
    if role == "admin" and int(data.get("e", 0)) > time.time() + LOGIN_TTL_ADMIN:
        # 예전에 12시간으로 발급된 선생님 표는 새 유효 시간(2시간)을 넘으므로 무효로 한다
        clear_login_token()
        return
    if role != "admin":
        # 학생은 표만 믿지 않고 지금 계정 상태를 다시 확인한다: 탈퇴했으면 무효, 반이 바뀌었으면 새 반으로.
        # (목록을 못 불러온 경우에도 안전하게 거부하고 다시 로그인하게 한다)
        current = {str(x.get("student_id", "")): str(x.get("class_id", "")) for x in admin_list_students()}
        if not student_id or student_id not in current:
            clear_login_token()
            return
        role = current[student_id] or "미배정"
    st.session_state.auth_role = role
    st.session_state.auth_student_id = student_id


if not st.session_state.auth_role:
    restore_login_from_token()

# 데이터 백업: 마지막 백업 시간을 보여 주고, 지금 바로 백업하는 버튼을 둔다 (조각으로 만들어 앱 전체가 다시 실행되지 않게)
@st.fragment
def backup_panel():
    with st.expander("💾 데이터 백업"):
        if not backup_ready():
            st.caption("Apps Script를 최신 버전으로 재배포하면 백업을 쓸 수 있어요.")
            return
        info = backup_info()
        if info.get("last_at"):
            try:
                when = datetime.datetime.fromisoformat(info["last_at"].replace("Z", "+00:00")).astimezone(
                    datetime.timezone(datetime.timedelta(hours=9)))
                st.caption(f"마지막 백업: {when:%Y-%m-%d %H:%M} ({'자동' if info.get('last_kind') == 'auto' else '직접'})")
            except ValueError:
                st.caption(f"마지막 백업: {info['last_at']}")
        else:
            st.warning("아직 백업이 없어요.")
        if info.get("last_error"):
            st.error("최근 백업에 실패한 적이 있어요. 아래 버튼으로 다시 해 보세요.")
        if not info.get("auto"):
            st.caption("매주 자동 백업이 꺼져 있어요. Apps Script 편집기에서 setupWeeklyBackup을 한 번 실행하면 켜져요.")
        st.caption(f"드라이브 '수학클래스룸_백업' 폴더에 최근 {info.get('keep', 8)}개만 남겨요.")
        if st.button("지금 백업하기", key="backup_now_btn"):
            with st.spinner("백업하는 중..."):
                res = backup_now()
            if res.get("ok"):
                st.success("백업했어요.")
                st.rerun(scope="fragment")
            else:
                safe_error("백업하지 못했어요.", res.get("error", ""))


# 데이터베이스(Supabase) 이전 작업용: 연결 주소가 등록됐는지, 접속되는지, 표가 다 있는지 확인한다.
# 기능별로 하나씩 옮기는 중이다(옮긴 기능은 STORAGE_BACKEND 가 supabase 일 때 이 데이터베이스를 쓴다).
@st.fragment
def db_panel():
    with st.expander("🗄️ 데이터베이스 연결 확인 (Supabase)"):
        url = str(st.secrets.get("SUPABASE_DB_URL", "") or "").strip()
        if not url:
            st.caption("연결 주소(SUPABASE_DB_URL)가 아직 등록되지 않았어요. Streamlit Secrets에 추가하면 여기서 확인할 수 있어요.")
            return
        st.caption(f"저장 방식 설정: {storage_backend()} (계정·앱 스위치·문제 은행·유형표만 옮겨진 상태. 전체를 옮기기 전까지는 sheet를 그대로 둡니다)")
        if st.button("연결 확인", key="db_ping_btn"):
            with st.spinner("연결하는 중..."):
                res = dbconn.ping(url)
            if not res["ok"]:
                logging.error("DB 연결 확인 실패: %s", _mask_secrets(res["error"]))
                st.error("연결하지 못했어요. 연결 주소(비밀번호 포함)와 Supabase 프로젝트가 켜져 있는지 확인해 주세요.")
                st.caption(res["error"])
                return
            st.success(f"연결됐어요 ({res['ms']}ms, Postgres {res['version']})")
            total = len(dbconn.EXPECTED_TABLES)
            if res["missing"]:
                st.warning(f"표 {len(res['found'])}/{total}개만 있어요. 없는 표: {', '.join(res['missing'])}. db/schema.sql 을 SQL Editor에서 실행해 주세요.")
            else:
                st.caption(f"표 {total}/{total}개 확인")
            if not res.get("bypass_rls", True):
                st.error("이 연결 계정은 접근 제한(RLS)을 건너뛸 수 없어서 앱이 데이터를 읽고 쓸 수 없어요. 연결 주소의 사용자가 postgres 계정인지 확인해 주세요.")
            if res["rls_off"]:
                st.error(f"접근 제한(RLS)이 꺼진 표가 있어요: {', '.join(res['rls_off'])}. db/schema.sql 을 다시 실행해 주세요.")


# 학생 계정 관리는 따로 새로고침되는 조각(fragment)으로 만들어,
# 스위치나 선택을 바꿔도 앱 전체가 다시 실행되지 않게 함
@st.fragment
def student_admin_panel(class_list):
    if st.toggle("🛠️ 학생 계정 관리 (반 배정·탈퇴)", key="show_student_admin"):
        st.subheader("👥 학생 반 배정")
        with st.spinner("학생 목록 불러오는 중..."):
            student_list = admin_list_students()
        if student_list:
            sid_options = [s.get("student_id", "") for s in student_list]
            pick_sid = st.selectbox("학생 아이디", sid_options, key="assign_pick_sid")
            picked = next((s for s in student_list if s.get("student_id") == pick_sid), None)
            current_assigned = picked.get("class_id", "") if picked else ""
            st.caption(f"현재 배정: {current_assigned or '(미배정)'}")
            pick_class = st.selectbox("배정할 반", class_list, key="assign_pick_class")
            if st.button("배정하기", key="assign_btn"):
                if admin_assign_class(pick_sid, pick_class):
                    st.success(f"{pick_sid} → {pick_class} 배정 완료!")
                    st.rerun(scope="fragment")
                else:
                    st.error("배정에 실패했습니다.")
        else:
            st.caption("아직 가입한 학생이 없습니다.")

        st.divider()
        st.subheader("🚫 학생 탈퇴 처리")
        # ★ 수정: 관리자가 특정 학생을 강제 탈퇴시키는 기능. 위에서 이미 불러온
        # student_list를 재사용해서 목록을 다시 조회하지 않음.
        if student_list:
            wd_sid_options = [s.get("student_id", "") for s in student_list]
            wd_pick_sid = st.selectbox("탈퇴시킬 학생 아이디", wd_sid_options, key="admin_withdraw_pick_sid")
            st.caption("⚠️ 탈퇴 처리하면 해당 학생의 계정과 학생 기록(숙제 결과, 시험 점수, 중요 표시, 개인 보관함, 문제 배정)이 삭제되며, 되돌릴 수 없습니다. 문제 은행의 문제는 그대로 남습니다.")
            wd_admin_confirm = st.checkbox(f"'{wd_pick_sid}' 학생을 정말 탈퇴시키겠습니까?", key="admin_withdraw_confirm")
            if st.button("탈퇴 처리하기", key="admin_withdraw_btn"):
                if not wd_admin_confirm:
                    st.warning("확인 체크박스를 선택해주세요.")
                else:
                    with st.spinner("탈퇴 처리 중..."):
                        ok = admin_withdraw_student(wd_pick_sid)
                    if ok:
                        st.success(f"'{wd_pick_sid}' 학생을 탈퇴 처리했습니다.")
                        st.rerun(scope="fragment")
                    else:
                        st.error("탈퇴 처리에 실패했습니다.")
        else:
            st.caption("아직 가입한 학생이 없습니다.")


with st.sidebar:
    st.header("🔑 클래스룸 입장하기")

    if st.session_state.auth_role:
        # 이미 로그인된 상태
        if st.session_state.auth_role == "admin":
            st.success("👨‍🏫 선생님으로 로그인됨")
        elif st.session_state.auth_role == "미배정":
            st.warning(f"🎓 학생 ({st.session_state.auth_student_id}) - 아직 반 배정 전")
        else:
            st.success(f"🎓 학생 ({st.session_state.auth_student_id}) - {st.session_state.auth_role}반")
        if st.button("로그아웃"):
            st.session_state.auth_role = None
            st.session_state.auth_student_id = None
            clear_login_token()
            st.rerun()

        # ★ 수정: 학생 본인 탈퇴 기능 (비밀번호 재확인 + 확인 체크박스 필요)
        if st.session_state.auth_role != "admin":
            with st.expander("⚠️ 회원 탈퇴"):
                st.caption("탈퇴하면 계정과 내 기록(숙제 결과, 시험 점수, 중요 표시, 받은 문제 배정)이 삭제되며, 되돌릴 수 없습니다.")
                wd_pw = st.text_input("본인 확인을 위해 비밀번호를 입력하세요", type="password", key="withdraw_pw")
                wd_confirm = st.checkbox("탈퇴 시 모든 데이터가 삭제된다는 것을 이해했습니다", key="withdraw_confirm")
                if st.button("탈퇴하기", key="withdraw_btn"):
                    if not wd_pw:
                        st.warning("비밀번호를 입력해주세요.")
                    elif not wd_confirm:
                        st.warning("탈퇴 확인 체크박스를 선택해주세요.")
                    else:
                        with st.spinner("탈퇴 처리 중..."):
                            result = student_withdraw(st.session_state.auth_student_id, wd_pw)
                        if result.get("ok"):
                            st.session_state.auth_role = None
                            st.session_state.auth_student_id = None
                            clear_login_token()
                            st.success("탈퇴 처리되었습니다.")
                            st.rerun()
                        else:
                            st.error(result.get("error", "탈퇴에 실패했습니다."))
    else:
        login_mode = st.radio("로그인 유형", ["학생", "선생님"], horizontal=True)

        if login_mode == "선생님":
            entered_pw = st.text_input("선생님 비밀번호", type="password", key="admin_pw_input")
            if st.button("로그인", key="admin_login_btn"):
                if not admin_pw:
                    st.error("Secrets에 ADMIN_PASSWORD가 설정되지 않아 선생님 로그인을 할 수 없습니다.")
                elif entered_pw == admin_pw:
                    st.session_state.auth_role = "admin"
                    save_login_token("admin", None)
                    st.rerun()
                else:
                    st.error("비밀번호가 틀렸습니다.")
        else:
            st.subheader("학생 로그인")
            sid = st.text_input("아이디", key="login_sid")
            spw = st.text_input("비밀번호", type="password", key="login_spw")
            if st.button("로그인", key="student_login_btn"):
                if sid and spw:
                    with st.spinner("확인하는 중..."):
                        result = student_login(sid, spw)
                    if result.get("ok"):
                        st.session_state.auth_role = result.get("class_id") or "미배정"
                        st.session_state.auth_student_id = sid.strip()
                        save_login_token(st.session_state.auth_role, sid.strip())
                        st.rerun()
                    else:
                        st.error(result.get("error", "로그인에 실패했습니다."))
                else:
                    st.warning("아이디와 비밀번호를 입력해주세요.")

            with st.expander("🆕 계정이 없으신가요? 회원가입"):
                new_sid = st.text_input("사용할 아이디", key="signup_sid")
                new_pw = st.text_input("비밀번호", type="password", key="signup_pw")
                new_pw2 = st.text_input("비밀번호 확인", type="password", key="signup_pw2")
                if st.button("가입하기", key="signup_btn"):
                    if not new_sid or not new_pw:
                        st.warning("아이디와 비밀번호를 입력해주세요.")
                    elif new_pw != new_pw2:
                        st.error("비밀번호가 서로 다릅니다.")
                    elif len(new_pw) < 4:
                        st.error("비밀번호는 4자 이상으로 해주세요.")
                    else:
                        with st.spinner("가입하는 중..."):
                            result = student_signup(new_sid, new_pw)
                        if result.get("ok"):
                            st.session_state.auth_role = "미배정"
                            st.session_state.auth_student_id = new_sid.strip()
                            save_login_token("미배정", new_sid.strip())
                            st.success("가입 완료! 선생님이 반을 배정해주시면 게시판을 볼 수 있어요.")
                            st.rerun()
                        else:
                            st.error(result.get("error", "가입에 실패했습니다."))

    current_role = st.session_state.auth_role
    current_student_id = st.session_state.auth_student_id

    if current_role == "admin":
        st.divider()
        st.header("⚙️ 앱 전체 관리 (스위치)")
        current_status = get_app_status()
        new_status = st.radio("학생 접속 허용", ["ON (수업 중)", "OFF (잠금)"], index=0 if current_status == "ON" else 1)
        if "ON" in new_status and current_status == "OFF":
            set_app_status("ON"); st.rerun()
        elif "OFF" in new_status and current_status == "ON":
            set_app_status("OFF"); st.rerun()

        st.divider()
        student_admin_panel(class_list)
        backup_panel()
        db_panel()

# ==========================================
# 화면 차단 로직
# ==========================================
if not current_role:
    st.info("👈 왼쪽 메뉴에서 로그인해야 클래스룸에 입장할 수 있습니다.")
    st.stop()

if current_role != "admin" and get_app_status() == "OFF":
    st.error("⛔ 현재는 수학 앱 사용 시간이 아닙니다. 선생님이 수업을 열어주시면 새로고침(F5) 하세요.")
    st.stop()

if not (mathpix_app_id and mathpix_app_key and gemini_api_key):
    st.error("⚠️ 선생님의 API 키가 Secrets에 설정되지 않아 앱을 실행할 수 없습니다.")
    st.stop()

if current_role == "admin":
    st.caption("현재 접속 권한: **선생님 (모든 반 관리)**")
elif current_role == "미배정":
    st.caption(f"현재 접속 권한: **학생 ({current_student_id}) - 반 배정 대기중**")
else:
    st.caption(f"현재 접속 권한: **학생 ({current_student_id}) - {current_role}반**")

if current_role == "admin" and sheet_url and not sheet_api_token:
    st.warning(
        "⚠️ 보안 경고: SHEET_API_TOKEN이 설정되어 있지 않습니다. "
        "지금은 구글 시트 주소만 알면 앱을 거치지 않고도 누구나 과제를 추가/삭제할 수 있는 상태입니다. "
        "Secrets에 SHEET_API_TOKEN을 추가하고, Apps Script 쪽 스크립트 속성에도 같은 값을 넣어주세요."
    )

# ==========================================
# 메인 화면: 탭 구성 (학생으로 로그인 시에만 '내 보관함' 탭 추가)
# ==========================================
# ★ 수정: 문제는 선생님만 만든다. 학생은 선생님이 저장해 준 문제를 보기만 한다.
tab2 = tab_archive = tab_stats = tab_mine = tab_star = tab_bank = tab_similar = None
tab_hw = tab_report = tab_my_hw = None
if current_role == "admin":
    tab2, tab_bank, tab_hw, _tab_archive_root, tab_report = st.tabs(
        ["📸 문제 만들기", "🏦 문제 은행", "📝 숙제", "🗄️ 학생 보관함", "📈 성적·리포트"])
    # 학생 보관함 안에: 배정한 문제 / 학생별 유형 현황 (비슷한 문제 찾기는 문제 은행 탭 안에서 만든다)
    with _tab_archive_root:
        tab_archive, tab_stats = st.tabs(["🗂️ 배정한 문제", "📊 학생별 유형 현황"])
else:
    # 학생: 숙제 → 선생님이 배정해 준 문제(날짜별·단원별) → 중요 문제함
    tab_my_hw, tab_mine, tab_star = st.tabs(["📝 숙제", "📚 내 문제", "⭐ 중요 문제함"])

# ------------------------------------------
# [탭 2] 개인용 문제 생성기 & 화면 직관적 수정 에디터
# ------------------------------------------
if tab2 is not None:
    with tab2:
        st.subheader("📸 모르는 문제를 찍어 유사 문제를 만드세요")
    
        if "ocr_text" not in st.session_state: st.session_state.ocr_text = ""
        if "similar_problems" not in st.session_state: st.session_state.similar_problems = None
        if "current_image_b64" not in st.session_state: st.session_state.current_image_b64 = None

        uploaded_file = st.file_uploader("문제 사진을 찍거나 업로드하세요", type=["png", "jpg", "jpeg"], key="uploader")

        if uploaded_file and st.button("📸 사진에서 수식 추출하기"):
            with st.spinner("Mathpix AI가 수식을 인식하는 중..."):
                try:
                    base64_image = base64.b64encode(uploaded_file.getvalue()).decode('utf-8')
                    st.session_state.current_image_b64 = base64_image 
                    image_url = f"data:image/jpeg;base64,{base64_image}"
                
                    headers = {"app_id": mathpix_app_id, "app_key": mathpix_app_key, "Content-type": "application/json"}
                    data = {"src": image_url, "formats": ["text", "latex_styled"]}
                
                    res = requests.post("https://api.mathpix.com/v3/text", headers=headers, json=data, timeout=60)
                    result_json = res.json()
                
                    if "text" in result_json:
                        math_text = result_json["text"]
                        math_text = re.sub(r'\\\(\s*', '$', math_text); math_text = re.sub(r'\s*\\\)', '$', math_text); math_text = re.sub(r'\\\[\s*', '$$', math_text); math_text = re.sub(r'\s*\\\]', '$$', math_text)
                        st.session_state.ocr_text = math_text
                        st.success("수식 및 표 추출 성공! 내용을 확인하고 필요시 수정해 주세요.")
                    else:
                        st.error("인식에 실패했습니다. 다시 시도해 주세요.")
                except Exception as e:
                    safe_error("오류가 발생했습니다.", e)

        if st.session_state.ocr_text:
            if st.session_state.current_image_b64:
                st.image(f"data:image/jpeg;base64,{st.session_state.current_image_b64}", caption="[원본 도형 이미지]", use_container_width=True)

            edited_text = st.text_area("도형 조건이나 수식 중 누락된 부분을 수정하세요:", value=st.session_state.ocr_text, height=150)
            st.session_state.ocr_text = edited_text
            st.markdown("**수식 및 표 렌더링 미리보기:**")
            st.markdown(format_math(edited_text), unsafe_allow_html=True)
        
            include_detailed = st.checkbox("📖 상세 단계별 해설 포함하기 (체크 해제 시 핵심 풀이만 생성)", value=False)
        
            if st.button("✨ 유사 문제 2개 초고속 생성 (기본1 + 응용1)", type="primary"):
                with st.spinner("AI가 [1번 기본 다지기]와 [2번 실력 키우기]를 동시에 차별화하여 병렬 생성하고 있습니다 (약 3~5초)..."):
                    try:
                        solution_instruction = "단계별 상세 풀이와 해설 작성" if include_detailed else "핵심 수식 전개 및 정답 도출 과정만 1~2줄로 매우 간결하게 작성"
                        fast_model = get_gemini_model_name()
                    
                        existing_tax = taxonomy_list() if bank_backend_ready() else []
                        with ThreadPoolExecutor(max_workers=3) as executor:
                            future_p1 = executor.submit(generate_one_problem_async, "1번 기본 다지기 문제", 1, edited_text, solution_instruction, gemini_api_key, fast_model)
                            future_p2 = executor.submit(generate_one_problem_async, "2번 실력 키우기 문제", 2, edited_text, solution_instruction, gemini_api_key, fast_model)
                            # 보관함 저장용 유형(학년 › 단원 › 세부 유형)도 동시에 AI가 제안
                            future_type = executor.submit(classify_frame, edited_text, existing_tax, gemini_api_key, fast_model)
                        
                            p1_res = future_p1.result()
                            p2_res = future_p2.result()
                            try:
                                st.session_state.suggested_frame = future_type.result()
                                # 학생 보관함 저장 칸(학년 › 단원 › 세부 유형)에도 같은 분류를 채워 둔다
                                st.session_state.suggested_type = {
                                    "grade": st.session_state.suggested_frame.get("grade", ""),
                                    "unit": st.session_state.suggested_frame.get("unit", ""),
                                    "subtype": st.session_state.suggested_frame.get("frame", ""),
                                }
                            except Exception:
                                # 유형 제안이 실패해도 문제 생성 결과는 그대로 쓴다 (선생님이 직접 입력)
                                st.session_state.suggested_type = None
                                st.session_state.suggested_frame = None
                    
                        st.session_state.similar_problems = [p1_res, p2_res]
                        st.session_state.edit_ver = st.session_state.get("edit_ver", 0) + 1
                        st.success("⚡ 차별화된 유사 문제 2개 초고속 병렬 생성 완료!")
                    except Exception as e:
                        safe_error("오류가 발생했습니다.", e)

            # ==========================================
            # ★ 화면에서 직관적으로 수정하는 실시간 인터페이스
            # ==========================================
            if st.session_state.similar_problems:
                st.divider()
                st.subheader("🎯 생성된 연습 문제")
            
                p1 = st.session_state.similar_problems[0]
                p2 = st.session_state.similar_problems[1]
            
                # 관리자(선생님) 전용 과제 등록 바
                if current_role == "admin":
                    # 빠른 단어·숫자 1초 교체 도구
                    with st.expander("⚡ [빠른 단어·숫자 바꾸기] 화면을 보면서 오타/숫자만 1초 교체", expanded=False):
                        st.caption("수식 코드를 건드릴 필요 없이, 문제 화면에 보이는 글자나 숫자를 적어주시면 즉시 바뀝니다.")
                        col_tgt, col_find, col_replace, col_btn = st.columns([1.2, 1.5, 1.5, 1])
                        with col_tgt:
                            replace_target_prob = st.selectbox("수정할 문제", ["1번 문제", "2번 문제", "1번+2번 전체"])
                        with col_find:
                            find_str = st.text_input("바꿀 대상 (예: (가) 또는 30)", key="find_str")
                        with col_replace:
                            replace_str = st.text_input("새로운 값 (예: (나) 또는 25)", key="replace_str")
                        with col_btn:
                            st.write("")
                            st.write("")
                            if st.button("🔄 바꾸기"):
                                if find_str:
                                    if "1번" in replace_target_prob or "전체" in replace_target_prob:
                                        p1["question"] = p1["question"].replace(find_str, replace_str)
                                        p1["answer"] = p1["answer"].replace(find_str, replace_str)
                                        p1["solution"] = p1["solution"].replace(find_str, replace_str)
                                    if "2번" in replace_target_prob or "전체" in replace_target_prob:
                                        p2["question"] = p2["question"].replace(find_str, replace_str)
                                        p2["answer"] = p2["answer"].replace(find_str, replace_str)
                                        p2["solution"] = p2["solution"].replace(find_str, replace_str)
                                    st.session_state.edit_ver = st.session_state.get("edit_ver", 0) + 1
                                    st.success(f"'{find_str}' ➔ '{replace_str}' 교체 완료!")
                                    st.rerun()

                # 1번 문제 카드
                with st.container():
                    st.markdown("### [문제 1] 기본 다지기")
                    st.markdown(format_math(p1.get("question", "")), unsafe_allow_html=True)
                
                    with st.expander("🔍 1번 정답 및 풀이 확인"):
                        st.markdown(f"**정답:** {format_math(p1.get('answer', ''))}", unsafe_allow_html=True)
                        if p1.get("solution"):
                            st.markdown(f"**풀이:**\n\n{format_math(p1.get('solution', ''))}", unsafe_allow_html=True)
                
                    if current_role == "admin":
                        if st.checkbox("✏️ 1번 문제/정답/풀이 화면에서 직접 수정하기", key="chk_edit_p1"):
                            p1_q_new = st.text_area("1번 지문 내용:", value=p1.get("question", ""), key=f"inline_p1_q_{st.session_state.get('edit_ver', 0)}", height=120)
                            col_a1, col_s1 = st.columns([1, 2])
                            with col_a1:
                                p1_a_new = st.text_input("1번 정답:", value=p1.get("answer", ""), key=f"inline_p1_a_{st.session_state.get('edit_ver', 0)}")
                            with col_s1:
                                p1_s_new = st.text_area("1번 풀이:", value=p1.get("solution", ""), key=f"inline_p1_s_{st.session_state.get('edit_ver', 0)}", height=120)
                        
                            p1["question"] = p1_q_new
                            p1["answer"] = p1_a_new
                            p1["solution"] = p1_s_new
                st.divider()

                # 2번 문제 카드
                with st.container():
                    st.markdown("### [문제 2] 실력 키우기")
                    st.markdown(format_math(p2.get("question", "")), unsafe_allow_html=True)
                
                    with st.expander("🔍 2번 정답 및 풀이 확인"):
                        st.markdown(f"**정답:** {format_math(p2.get('answer', ''))}", unsafe_allow_html=True)
                        if p2.get("solution"):
                            st.markdown(f"**풀이:**\n\n{format_math(p2.get('solution', ''))}", unsafe_allow_html=True)
                
                    if current_role == "admin":
                        if st.checkbox("✏️ 2번 문제/정답/풀이 화면에서 직접 수정하기", key="chk_edit_p2"):
                            p2_q_new = st.text_area("2번 지문 내용:", value=p2.get("question", ""), key=f"inline_p2_q_{st.session_state.get('edit_ver', 0)}", height=120)
                            col_a2, col_s2 = st.columns([1, 2])
                            with col_a2:
                                p2_a_new = st.text_input("2번 정답:", value=p2.get("answer", ""), key=f"inline_p2_a_{st.session_state.get('edit_ver', 0)}")
                            with col_s2:
                                p2_s_new = st.text_area("2번 풀이:", value=p2.get("solution", ""), key=f"inline_p2_s_{st.session_state.get('edit_ver', 0)}", height=120)
                        
                            p2["question"] = p2_q_new
                            p2["answer"] = p2_a_new
                            p2["solution"] = p2_s_new
                st.write("")
                st.divider()
                # ==========================================
                # ★ 저장하고 학생에게 배정: 분류(학년·학기·단원·유형·문제틀) · 난이도 → 문제 은행,
                #   배정 학생이 있으면 학생 보관함에도 넣고 학생마다 중요·틀림·어려워함을 체크
                # ==========================================
                st.subheader("💾 저장하고 학생에게 배정하기")
                if not (bank_backend_ready() and archive_backend_ready()):
                    st.warning(BANK_SETUP_MSG)
                else:
                    _bver = st.session_state.get("edit_ver", 0)
                    _bsug = st.session_state.get("suggested_frame") or {}
                    _tax = taxonomy_list()
                    if _bsug:
                        st.caption(f"🤖 AI 제안: {frame_path(_bsug)}" + (f" · {_bsug['semester']}" if _bsug.get("semester") else "")
                                   + (" (새 문제틀)" if _bsug.get("is_new_frame") else " (기존 문제틀)"))
                    _main = taxonomy_picker(f"bk_main_{_bver}", _tax, suggestion=_bsug, with_semester=tags_backend_ready())
                    _desc_default = _bsug.get("description", "") if _bsug.get("frame") == _main.get("frame") else ""
                    _frame_desc = ""
                    if _main.get("is_new_frame"):
                        _frame_desc = st.text_input("새 문제틀 설명 (어떤 조건에서 무엇을 구하는 문제인지)", value=_desc_default, key=f"bk_desc_{_bver}")

                    st.markdown("**문제별 난이도** (문제 은행에 넣을 문제만 체크)")
                    _rows = []
                    _orig_diff = _bsug.get("difficulty", "중") if _bsug.get("difficulty") in DIFFICULTIES else "중"
                    _candidates = [
                        ("원본", "📷 원본 문제", st.session_state.ocr_text, "", "", _orig_diff),
                        ("AI 기본", "[유사문제 1] 기본 다지기", p1["question"], p1["answer"], p1.get("solution", ""), _orig_diff),
                        ("AI 실력", "[유사문제 2] 실력 키우기", p2["question"], p2["answer"], p2.get("solution", ""),
                         DIFFICULTIES[min(DIFFICULTIES.index(_orig_diff) + 1, 2)]),
                    ]
                    for _i, (_src, _label, _q, _a, _s, _d) in enumerate(_candidates):
                        with st.container(border=True):
                            _cA, _cB, _cC = st.columns([2.2, 1, 1.2])
                            with _cA:
                                _inc = st.checkbox(_label, value=True, key=f"bk_inc_{_i}_{_bver}")
                            with _cB:
                                _diff = st.selectbox("난이도", DIFFICULTIES, index=DIFFICULTIES.index(_d), key=f"bk_diff_{_i}_{_bver}",
                                                     label_visibility="collapsed")
                            with _cC:
                                _ver = st.checkbox("✅ 검수 완료", value=False, key=f"bk_ver_{_i}_{_bver}",
                                                   help="정답과 풀이까지 확인한 문제만 체크하세요. 비슷한 문제 찾기·숙제에는 검수 완료 문제가 먼저 나갑니다.")
                            _cls = _main
                            _cls_desc = _frame_desc
                            if _src != "원본" and st.checkbox("이 문제는 다른 문제틀", key=f"bk_other_{_i}_{_bver}"):
                                _cls = taxonomy_picker(f"bk_cls_{_i}_{_bver}", _tax, suggestion=_main)
                                _cls_desc = st.text_input("새 문제틀 설명", key=f"bk_cdesc_{_i}_{_bver}") if _cls.get("is_new_frame") else ""
                            if _inc:
                                _rows.append({
                                    "grade": _cls.get("grade", ""), "unit": _cls.get("unit", ""), "type": _cls.get("type", ""),
                                    "frame": _cls.get("frame", ""), "frame_description": _cls_desc,
                                    "difficulty": _diff, "source": _src, "question": _q, "answer": _a, "solution": _s,
                                    "verified": _ver, "memo": "", "use_image": _src == "원본",
                                })

                    st.markdown("**배정 학생** (여러 명 선택 가능, 비워 두면 문제 은행에만 저장)")
                    _all_students = admin_list_students()
                    col_cls, col_date = st.columns([1, 1])
                    with col_cls:
                        _cls_filter = st.selectbox("반", ["전체"] + class_list, key="arch_cls_filter")
                    with col_date:
                        _arch_date = st.date_input("날짜", value=datetime.date.today(), key="arch_date")
                    _student_options = [s.get("student_id", "") for s in _all_students
                                        if _cls_filter == "전체" or s.get("class_id", "") == _cls_filter]
                    _picked_students = st.multiselect("배정 학생", _student_options, key=f"arch_students_{_bver}",
                                                      label_visibility="collapsed", placeholder="학생을 고르세요")
                    _per_tags = {}
                    if _picked_students:
                        if tags_backend_ready():
                            st.caption("학생마다 원본 문제와 유사문제 1·2번을 ⭐중요 ❌틀림 😣어려워함으로 체크하세요. 여러 개를 함께 고를 수 있어요.")
                            for _sid in _picked_students:
                                with st.container(border=True):
                                    _sc0, _sc1, _sc2, _sc3 = st.columns([0.8, 1, 1, 1])
                                    with _sc0:
                                        st.markdown(f"**👤 {_sid}**")
                                    _t = []
                                    for _n, (_col, _lbl) in enumerate(((_sc1, "원본"), (_sc2, "유사문제 1"), (_sc3, "유사문제 2"))):
                                        with _col:
                                            _t.append(st.pills(_lbl, TAG_NAMES, selection_mode="multi", key=f"arch_tg_{_n}_{_sid}_{_bver}") or [])
                                    _per_tags[_sid] = tuple(_t)
                        else:
                            st.caption(TAGS_SETUP_MSG)
                    _memo = st.text_input("메모 (선택)", key=f"arch_memo_{_bver}", placeholder="예: 3단계 이항에서 부호 실수")

                    if st.button("💾 저장하기", type="primary", key=f"bk_save_{_bver}"):
                        _missing = [r for r in _rows if not all(r.get(lv) for lv in TAX_LEVELS)]
                        if not _rows and not _picked_students:
                            st.warning("문제 은행에 넣을 문제를 체크하거나 배정할 학생을 골라 주세요.")
                        elif _missing or not all(_main.get(lv) for lv in TAX_LEVELS):
                            st.warning("학년·단원·유형·문제틀을 모두 정해 주세요.")
                        else:
                            _msgs = []
                            _img_full = compress_image_for_storage(st.session_state.current_image_b64, max_dimension=1400, max_chars=3_000_000)
                            if _main.get("semester"):
                                unit_semester_set(_main.get("grade", ""), _main.get("unit", ""), _main["semester"])
                            _payload = None
                            if _picked_students:
                                _class_of = {s.get("student_id", ""): s.get("class_id", "") for s in _all_students}
                                _classes = {_class_of.get(sid, "") for sid in _picked_students}
                                _payload = {
                                    "date": _arch_date.strftime("%Y-%m-%d") + datetime.datetime.now().strftime(" %H:%M"),
                                    "student_ids": ",".join(_picked_students),
                                    "class_id": _classes.pop() if len(_classes) == 1 else "",
                                    "grade": _main.get("grade", ""), "unit": _main.get("unit", ""), "subtype": _main.get("frame", ""),
                                    "source_text": st.session_state.ocr_text,
                                    "image_b64": _img_full,
                                    "q1": p1["question"], "a1": p1["answer"], "s1": p1.get("solution", ""),
                                    "q2": p2["question"], "a2": p2["answer"], "s2": p2.get("solution", ""),
                                    "memo": _memo,
                                    "student_tags": student_tags_json(_per_tags),
                                }
                            # 저장 요청 번호: 같은 문제 세트를 같은 내용으로 다시 저장하면(두 번 클릭, 재시도) 같은 번호가 되어
                            # 서버가 중복 저장하지 않는다. 고르는 문제·학생·구분·메모를 바꾸면 새 번호가 되어 새로 저장된다.
                            _gid = st.session_state.setdefault(f"save_gid_{_bver}", str(int(time.time() * 1000)))
                            _core = json.dumps({"rows": _rows, "payload": {k: v for k, v in (_payload or {}).items() if k not in ("date", "image_b64")}},
                                               sort_keys=True, ensure_ascii=False)
                            _rid = f"{_gid}x{hashlib.sha1(_core.encode('utf-8')).hexdigest()[:6]}"
                            if save_assign_ready():
                                with st.spinner("저장하는 중..."):
                                    _res = save_and_assign(_rid, _rows, _img_full if any(r["use_image"] for r in _rows) or _payload else "", _payload)
                                if _res.get("ok"):
                                    if _payload:
                                        archive_types.clear()
                                    if _res.get("duplicate"):
                                        _msgs.append("이미 저장되어 있어서 다시 저장하지 않았어요")
                                    else:
                                        if _rows:
                                            _msgs.append(f"문제 은행 {len(_rows)}문제")
                                        if _payload:
                                            _msgs.append(f"학생 배정 ({', '.join(_picked_students)})")
                                else:
                                    st.error(f"❌ 저장에 실패했습니다. 아무것도 저장되지 않았어요. 다시 눌러 주세요. ({_res.get('error', '알 수 없는 오류')})")
                            else:
                                # 예전 Apps Script(버전 6 이하): 두 번에 나눠 저장하되, 같은 번호로 다시 저장해도 서버가 중복을 막는다
                                if _rows:
                                    with st.spinner("문제 은행에 저장하는 중..."):
                                        _res = bank_save(_rows, _img_full if any(r["use_image"] for r in _rows) else "", group_id=_rid)
                                    if _res.get("ok"):
                                        _msgs.append(f"문제 은행 {len(_rows)}문제")
                                    else:
                                        st.error(f"❌ 문제 은행 저장에 실패했습니다: {_res.get('error', '알 수 없는 오류')}")
                                if _payload:
                                    with st.spinner("학생 보관함에 배정하는 중..."):
                                        _result = archive_save(dict(_payload, id=_rid))
                                    if _result.get("ok"):
                                        archive_types.clear()
                                        _msgs.append(f"학생 배정 ({', '.join(_picked_students)})")
                                    else:
                                        st.error(f"❌ 학생 배정에 실패했습니다: {_result.get('error', '알 수 없는 오류')}")
                            if _msgs:
                                st.success(f"✅ 저장 완료 · {' · '.join(_msgs)} · {frame_path(_main)}"
                                           + (f" · {_main['semester']}" if _main.get("semester") else ""))


# ==========================================
# ★ 보관 문제 화면 공통 부품
# ==========================================
def render_archive_problem_body(p, key_prefix):
    """보관 문제 1개의 원본 사진(요청 시) / 1번 / 2번 / 정답·풀이를 그린다."""
    if p.get("image_file_id"):
        if st.checkbox("🖼️ 원본 사진 보기", key=f"{key_prefix}_img_{p.get('id')}"):
            img = archive_image(p["image_file_id"])
            if img:
                st.image(f"data:image/jpeg;base64,{img}", use_container_width=True)
            else:
                st.caption("사진을 불러오지 못했습니다.")
    st.markdown("**[문제 1] 기본 다지기**")
    st.markdown(format_math(p.get("q1", "")), unsafe_allow_html=True)
    st.markdown("**[문제 2] 실력 키우기**")
    st.markdown(format_math(p.get("q2", "")), unsafe_allow_html=True)
    with st.expander("🔍 정답 및 풀이"):
        st.markdown(f"**1번 정답:** {format_math(p.get('a1', ''))}", unsafe_allow_html=True)
        if p.get("s1"):
            st.markdown(f"**1번 풀이:**\n\n{format_math(p.get('s1', ''))}", unsafe_allow_html=True)
        st.markdown(f"**2번 정답:** {format_math(p.get('a2', ''))}", unsafe_allow_html=True)
        if p.get("s2"):
            st.markdown(f"**2번 풀이:**\n\n{format_math(p.get('s2', ''))}", unsafe_allow_html=True)


def _type_filter_widgets(types, key_prefix):
    """학년 → 단원 → 세부 유형 순서로 좁혀 가는 선택 상자 3개. (grade, unit, subtype) 반환."""
    col1, col2, col3 = st.columns([1, 1.3, 1.7])
    with col1:
        grades = sorted({t.get("grade", "") for t in types if t.get("grade")})
        grade = st.selectbox("학년", ["전체"] + grades, key=f"{key_prefix}_grade")
    with col2:
        units = sorted({t.get("unit", "") for t in types
                        if t.get("unit") and (grade == "전체" or t.get("grade") == grade)})
        unit = st.selectbox("단원", ["전체"] + units, key=f"{key_prefix}_unit")
    with col3:
        subs = sorted({t.get("subtype", "") for t in types
                       if t.get("subtype") and (grade == "전체" or t.get("grade") == grade)
                       and (unit == "전체" or t.get("unit") == unit)})
        subtype = st.selectbox("세부 유형", ["전체"] + subs, key=f"{key_prefix}_subtype")
    norm = lambda v: "" if v == "전체" else v
    return norm(grade), norm(unit), norm(subtype)


# ------------------------------------------
# [선생님] 문제 보관함 검색 / 인쇄 / 관리
# ------------------------------------------
if tab_archive is not None:
    with tab_archive:
        st.subheader("🗄️ 학생 보관함")
        if not archive_backend_ready():
            st.warning(ARCHIVE_SETUP_MSG)
        else:
            _types_all = archive_types()
            _students_all = admin_list_students()

            col_d, col_c, col_st = st.columns([1.4, 1, 1.2])
            with col_d:
                _range = st.date_input(
                    "기간",
                    value=(datetime.date.today() - datetime.timedelta(days=30), datetime.date.today()),
                    key="ab_range",
                )
            with col_c:
                _ab_class = st.selectbox("반", ["전체"] + class_list, key="ab_class")
            with col_st:
                _ab_student_opts = [s.get("student_id", "") for s in _students_all
                                    if _ab_class == "전체" or s.get("class_id", "") == _ab_class]
                _ab_student = st.selectbox("학생", ["전체"] + _ab_student_opts, key="ab_student")
            _ab_grade, _ab_unit, _ab_subtype = _type_filter_widgets(_types_all, "ab")
            _ab_keyword = st.text_input("🔎 문제 내용·메모 검색어", key="ab_keyword")

            if isinstance(_range, (tuple, list)) and len(_range) == 2:
                _ab_from, _ab_to = _range[0].strftime("%Y-%m-%d"), _range[1].strftime("%Y-%m-%d")
            elif isinstance(_range, (tuple, list)) and len(_range) == 1:
                _ab_from = _ab_to = _range[0].strftime("%Y-%m-%d")
            else:
                _ab_from = _ab_to = ""

            _filters = dict(
                student="" if _ab_student == "전체" else _ab_student,
                class_id="" if _ab_class == "전체" else _ab_class,
                grade=_ab_grade, unit=_ab_unit, subtype=_ab_subtype,
                date_from=_ab_from, date_to=_ab_to, keyword=_ab_keyword.strip(),
            )
            # 조건이 바뀌면 '더 보기' 개수를 처음으로 되돌린다
            _sig = json.dumps(_filters, sort_keys=True, ensure_ascii=False)
            if st.session_state.get("ab_sig") != _sig:
                st.session_state.ab_sig = _sig
                st.session_state.ab_limit = 20

            with st.spinner("보관함을 검색하는 중..."):
                _res = archive_search(**_filters, limit=st.session_state.ab_limit)
            _items = _res["items"]
            st.caption(f"검색 결과 {_res['total']}개 중 {len(_items)}개 표시")

            if _items:
                with st.expander("🖨️ 검색 결과 시험지로 인쇄하기", expanded=False):
                    _labels = {f"{p.get('date', '')[:10]} · {p.get('student_ids') or '학생 미지정'} · {type_label(p)}  [{p.get('id')}]": p for p in _items}
                    _sel = st.multiselect("인쇄할 문제", list(_labels.keys()), default=list(_labels.keys()), key="ab_print_sel")
                    _sel_items = [_labels[k] for k in _sel]
                    if _sel_items:
                        _title = st.text_input("시험지 제목", value=f"수학 유사문제 ({_ab_from} ~ {_ab_to})", key="ab_print_title")
                        st.download_button(
                            f"📥 선택한 {len(_sel_items)}개 인쇄용 파일 받기",
                            data=make_printable_html(_title, _sel_items),
                            file_name="보관함_시험지.html", mime="text/html", key="ab_print_dl", type="primary",
                        )

            for p in _items:
                _sids = [x for x in (p.get("student_ids") or "").split(",") if x]
                _cnt = {t: sum(1 for sid in _sids if any(t in x for x in item_tags(p, sid))) for t in TAG_NAMES}
                _tags_head = " ".join(f"{TAG_ICON[t]}{n}명" for t, n in _cnt.items() if n)
                _head = f"📅 {p.get('date', '')} · 👤 {p.get('student_ids') or '학생 미지정'} · 🏷️ {type_label(p)}" + (f" · {_tags_head}" if _tags_head else "")
                with st.expander(_head):
                    if p.get("memo"):
                        st.info(f"📝 {p['memo']}")
                    render_archive_problem_body(p, "ab")
                    st.markdown("---")
                    if tags_backend_ready() and _sids:
                        _pid_ = p.get("id")
                        st.markdown("**학생별 구분** (⭐중요 ❌틀림 😣어려워함, 여러 개 가능)")
                        for _sid in _sids:
                            _cur_t = item_tags(p, _sid)
                            _s0, _s1, _s2, _s3 = st.columns([0.8, 1, 1, 1])
                            with _s0:
                                st.markdown(f"👤 {_sid}")
                            for _n, (_col, _lbl) in enumerate(((_s1, "원본"), (_s2, "유사문제 1"), (_s3, "유사문제 2"))):
                                with _col:
                                    st.pills(_lbl, TAG_NAMES, selection_mode="multi", default=_cur_t[_n], key=f"ab_tg_{_n}_{_sid}_{_pid_}")
                        if st.button("구분 저장", key=f"ab_tg_save_{_pid_}"):
                            _per = {sid: tuple(st.session_state.get(f"ab_tg_{n}_{sid}_{_pid_}") or [] for n in range(3)) for sid in _sids}
                            if archive_set_student_tags(_pid_, _per):
                                st.rerun()
                            else:
                                st.error("구분을 저장하지 못했어요.")
                    col_e1, col_e2 = st.columns([3, 1])
                    with col_e1:
                        _cur = [x for x in (p.get("student_ids") or "").split(",") if x]
                        _opts = sorted(set([s.get("student_id", "") for s in _students_all] + _cur))
                        _new = st.multiselect("대상 학생 바꾸기", _opts, default=_cur, key=f"ab_stu_{p.get('id')}")
                        if st.button("저장", key=f"ab_stu_save_{p.get('id')}"):
                            if archive_update_students(p.get("id"), _new):
                                st.success("대상 학생을 바꿨습니다.")
                                st.rerun()
                            else:
                                st.error("변경에 실패했습니다.")
                    with col_e2:
                        _confirm = st.checkbox("삭제 확인", key=f"ab_del_chk_{p.get('id')}")
                        if st.button("🗑️ 삭제", key=f"ab_del_{p.get('id')}", disabled=not _confirm):
                            if archive_delete(p.get("id")):
                                archive_types.clear()
                                st.success("삭제했습니다.")
                                st.rerun()
                            else:
                                st.error("삭제에 실패했습니다.")

            if len(_items) < _res["total"]:
                if st.button("⬇️ 더 보기", key="ab_more"):
                    st.session_state.ab_limit += 20
                    st.rerun()


# ------------------------------------------
# [선생님] 학생별 유형 현황
# ------------------------------------------
if tab_stats is not None:
    with tab_stats:
        import pandas as pd
        if not archive_backend_ready():
            st.warning(ARCHIVE_SETUP_MSG)
        else:
            st.caption("기간 안에 학생마다 어떤 유형의 문제를 몇 세트 받았는지 보여줍니다.")
            col_sd, col_sc = st.columns([1.4, 1])
            with col_sd:
                _srange = st.date_input(
                    "기간",
                    value=(datetime.date.today() - datetime.timedelta(days=90), datetime.date.today()),
                    key="st_range",
                )
            with col_sc:
                _st_class = st.selectbox("반", ["전체"] + class_list, key="st_class")
            if isinstance(_srange, (tuple, list)) and len(_srange) == 2:
                _st_from, _st_to = _srange[0].strftime("%Y-%m-%d"), _srange[1].strftime("%Y-%m-%d")
            else:
                _st_from = _st_to = ""

            with st.spinner("집계하는 중..."):
                _rows = archive_stats(_st_from, _st_to, "" if _st_class == "전체" else _st_class)

            if not _rows:
                st.info("이 기간에 보관된 문제가 없습니다.")
            else:
                _df = pd.DataFrame(_rows)
                _df["유형"] = _df.apply(lambda r: " › ".join(x for x in [r["unit"], r["subtype"]] if x) or "(유형 미지정)", axis=1)
                _level = st.radio("묶는 단위", ["세부 유형", "단원"], horizontal=True, key="st_level")
                _col = "유형" if _level == "세부 유형" else "unit"
                _pivot = _df.pivot_table(index="student_id", columns=_col, values="count", aggfunc="sum", fill_value=0)
                _pivot["합계"] = _pivot.sum(axis=1)
                _pivot = _pivot.sort_values("합계", ascending=False)
                _pivot.index.name = "학생"
                st.dataframe(_pivot, use_container_width=True)

                st.markdown("##### 👤 학생 한 명 자세히 보기")
                _one = st.selectbox("학생", sorted(_df["student_id"].unique()), key="st_one")
                _detail = (_df[_df["student_id"] == _one]
                           [["grade", "unit", "subtype", "count", "last_date"]]
                           .rename(columns={"grade": "학년", "unit": "단원", "subtype": "세부 유형",
                                            "count": "세트 수", "last_date": "마지막 날짜"})
                           .sort_values("세트 수", ascending=False))
                st.dataframe(_detail, use_container_width=True, hide_index=True)
                st.download_button(
                    "📥 현황표 CSV로 받기",
                    data=_pivot.to_csv().encode("utf-8-sig"),
                    file_name=f"학생별_유형현황_{_st_from}_{_st_to}.csv",
                    mime="text/csv",
                    key="st_csv",
                )


# ------------------------------------------
# [학생] 선생님이 나에게 준 문제
# ------------------------------------------
def unit_label(p):
    """학생 화면용: 세부 유형은 빼고 학년 › 단원까지만."""
    return " › ".join(x for x in (p.get("grade", ""), p.get("unit", "")) if x) or "(단원 미지정)"


_STAR_PREFIXES = ("sd", "su", "ss")


def _on_star_toggle(item_key, widget_key):
    on = bool(st.session_state.get(widget_key))
    if not star_set(current_student_id, item_key, on):
        st.session_state["star_error"] = True
    # 다른 탭에 그려진 같은 문제의 체크 상태도 새 값으로 다시 그려지게 한다
    for pfx in _STAR_PREFIXES:
        k = f"{pfx}_star_{item_key}"
        if k != widget_key:
            st.session_state.pop(k, None)


def render_student_item(p, prefix, keys, only_starred=False):
    """학생에게 배정된 보관 문제 1세트. 문제마다 ⭐ 중요 체크를 할 수 있다."""
    pid = p.get("id", "")
    if p.get("image_file_id") and not only_starred:
        if st.checkbox("🖼️ 원본 사진 보기", key=f"{prefix}_img_{pid}"):
            img = archive_image(p["image_file_id"])
            if img:
                st.image(f"data:image/jpeg;base64,{img}", use_container_width=True)
            else:
                st.caption("사진을 불러오지 못했습니다.")
    for n, title in ((1, "[문제 1] 기본 다지기"), (2, "[문제 2] 실력 키우기")):
        if not p.get(f"q{n}"):
            continue
        item_key = f"{pid}|{n}"
        if only_starred and item_key not in keys:
            continue
        c_title, c_star = st.columns([3, 1])
        with c_title:
            st.markdown(f"**{title}**")
        with c_star:
            wkey = f"{prefix}_star_{item_key}"
            st.checkbox("⭐ 중요", value=item_key in keys, key=wkey,
                        on_change=_on_star_toggle, args=(item_key, wkey))
        st.markdown(format_math(p.get(f"q{n}", "")), unsafe_allow_html=True)
        with st.expander(f"🔍 {n}번 정답 및 풀이"):
            st.markdown(f"**정답:** {format_math(p.get(f'a{n}', ''))}", unsafe_allow_html=True)
            if p.get(f"s{n}"):
                st.markdown(f"**풀이:**\n\n{format_math(p.get(f's{n}', ''))}", unsafe_allow_html=True)


if tab_mine is not None:
    with tab_mine:
        st.subheader("📚 내 문제")
        st.caption("선생님이 나에게 배정해 준 문제예요. 다시 보고 싶은 문제는 ⭐ 중요를 체크하면 '중요 문제함'에 모여요.")
        if st.session_state.pop("star_error", False):
            st.error("중요 표시를 저장하지 못했어요. 잠시 후 다시 해 주세요.")
        if not archive_backend_ready():
            st.info("선생님이 아직 문제를 배정해 주지 않았어요.")
        else:
            _keys = star_keys(current_student_id) if stars_backend_ready() else set()
            _how = st.radio("보기", ["📅 날짜별", "📘 단원별"], horizontal=True, key="mine_view",
                            label_visibility="collapsed")
            if _how == "📅 날짜별":
                if "mine_limit" not in st.session_state:
                    st.session_state.mine_limit = 30
                with st.spinner("불러오는 중..."):
                    _mres = archive_search(student=current_student_id, limit=st.session_state.mine_limit)
                _seen_ids = set()
                _mitems = [p for p in _mres["items"] if not (p.get("id") in _seen_ids or _seen_ids.add(p.get("id")))]
                if not _mitems:
                    st.info("아직 선생님이 배정해 준 문제가 없어요.")
                _by_date = {}
                for p in _mitems:
                    _by_date.setdefault(p.get("date", "")[:10], []).append(p)
                for _d in sorted(_by_date, reverse=True):
                    st.markdown(f"#### 📅 {_d}")
                    for p in _by_date[_d]:
                        with st.expander(f"📘 {unit_label(p)}"):
                            render_student_item(p, "sd", _keys)
                if len(_mres["items"]) < _mres["total"]:
                    if st.button("⬇️ 이전 문제 더 보기", key="mine_more"):
                        st.session_state.mine_limit += 30
                        st.rerun()
            else:
                _units = {}
                for r in archive_stats():
                    if r.get("student_id") == current_student_id:
                        _k = (r.get("grade", ""), r.get("unit", ""))
                        _units[_k] = _units.get(_k, 0) + int(r.get("count", 0) or 0)
                if not _units:
                    st.info("아직 선생님이 배정해 준 문제가 없어요.")
                else:
                    _ulist = sorted(_units)
                    _upick = st.selectbox(
                        "단원", _ulist, key="mine_unit",
                        format_func=lambda k: f"{unit_label({'grade': k[0], 'unit': k[1]})} ({_units[k]}세트)")
                    if st.session_state.get("mine_unit_prev") != _upick:
                        st.session_state.mine_unit_prev = _upick
                        st.session_state.mine_unit_limit = 30
                    with st.spinner("불러오는 중..."):
                        _ures = archive_search(student=current_student_id, grade=_upick[0], unit=_upick[1],
                                               limit=st.session_state.mine_unit_limit)
                    _seen_ids = set()
                    _uitems = [p for p in _ures["items"] if not (p.get("id") in _seen_ids or _seen_ids.add(p.get("id")))]
                    for p in sorted(_uitems, key=lambda x: x.get("date", ""), reverse=True):
                        with st.expander(f"📅 {p.get('date', '')[:10]}"):
                            render_student_item(p, "su", _keys)
                    if len(_ures["items"]) < _ures["total"]:
                        if st.button("⬇️ 이전 문제 더 보기", key="mine_unit_more"):
                            st.session_state.mine_unit_limit += 30
                            st.rerun()

if tab_star is not None:
    with tab_star:
        st.subheader("⭐ 중요 문제함")
        st.caption("'내 문제'에서 ⭐ 중요를 체크한 문제만 단원별로 모았어요. 체크를 풀면 여기서 빠져요.")
        if not (archive_backend_ready() and stars_backend_ready()):
            st.info("선생님이 앱을 새 버전으로 바꾸면 중요 문제함을 쓸 수 있어요.")
        else:
            _keys = star_keys(current_student_id)
            with st.spinner("불러오는 중..."):
                _sitems = star_items(current_student_id)
            if not _sitems:
                st.info("아직 중요 표시한 문제가 없어요. '내 문제' 탭에서 ⭐ 중요를 체크해 보세요.")
            else:
                _groups = {}
                for p in _sitems:
                    _groups.setdefault(unit_label(p), []).append(p)
                st.caption(f"중요 문제 {sum(1 for k in _keys if k.split('|')[0] in {p.get('id') for p in _sitems})}개")
                for _u in sorted(_groups):
                    st.markdown(f"#### 📘 {_u}")
                    for p in _groups[_u]:
                        with st.container(border=True):
                            st.caption(f"📅 {p.get('date', '')[:10]}")
                            render_student_item(p, "ss", _keys, only_starred=True)


# ------------------------------------------
# [선생님] 문제 은행: 찾기 / 유형표 / 옮기기
# ------------------------------------------
if tab_bank is not None:
    with tab_bank:
        st.subheader("🏦 문제 은행")
        if not bank_backend_ready():
            st.warning(BANK_SETUP_MSG)
        else:
            _btax = taxonomy_list()
            _total = sum(t.get("count", 0) for t in _btax)
            _verified = sum(t.get("verified", 0) for t in _btax)
            st.caption(f"문제틀 {len([t for t in _btax if t.get('frame')])}개 · 문제 {_total}개 (검수 완료 {_verified}개)")
            sub_find, tab_similar, sub_tax = st.tabs(["🔎 문제 찾기", "🔍 비슷한 문제 찾기", "🗂️ 유형표"])

            with sub_find:
                _f = {}
                c1, c2, c3, c4 = st.columns(4)
                for _col, _lv in zip((c1, c2, c3, c4), TAX_LEVELS):
                    with _col:
                        _opts = _children(_btax, _lv, _f)
                        _v = st.selectbox(TAX_LABELS[_lv], ["전체"] + _opts, key=f"bf_{_lv}")
                        if _v == "전체":
                            break
                        _f[_lv] = _v
                c5, c6, c7 = st.columns([1.4, 1, 1.6])
                with c5:
                    _bdiff = st.multiselect("난이도", DIFFICULTIES, default=DIFFICULTIES, key="bf_diff")
                with c6:
                    _bver_only = st.checkbox("검수 완료만", key="bf_ver")
                with c7:
                    _bkw = st.text_input("🔎 검색어 (문제·메모·문제틀)", key="bf_kw")
                _bfilters = dict(_f, difficulty=_bdiff, verified=_bver_only, keyword=_bkw.strip())
                _bsig = json.dumps(_bfilters, sort_keys=True, ensure_ascii=False)
                if st.session_state.get("bf_sig") != _bsig:
                    st.session_state.bf_sig = _bsig
                    st.session_state.bf_limit = 30
                with st.spinner("검색하는 중..."):
                    _bres = bank_search(limit=st.session_state.bf_limit, **_bfilters)
                _bitems = _bres["items"]
                st.caption(f"검색 결과 {_bres['total']}개 중 {len(_bitems)}개 표시")

                if _bitems:
                    with st.expander("🖨️ 검색 결과로 학습지 만들기"):
                        _plabels = {f"{frame_path(p)} · {p.get('difficulty', '')} · {p.get('source', '')} [{p.get('id')}]": p for p in _bitems}
                        _psel = st.multiselect("넣을 문제", list(_plabels.keys()), default=list(_plabels.keys())[:10], key="bf_print_sel")
                        _ptitle = st.text_input("학습지 제목", value="유형별 연습 문제", key="bf_print_title")
                        if _psel:
                            st.download_button(f"📥 {len(_psel)}문제 학습지 받기",
                                               data=make_problem_sheet_html(_ptitle, [_plabels[k] for k in _psel]),
                                               file_name="문제은행_학습지.html", mime="text/html", key="bf_print_dl", type="primary")
                            if st.button(f"📝 고른 {len(_psel)}문제 숙제 바구니에 담기", key="bf_to_cart"):
                                add_to_hw_cart([_plabels[k] for k in _psel])

                _by_frame = {}
                for p in _bitems:
                    _by_frame.setdefault(frame_path(p), []).append(p)
                for _path, _plist in _by_frame.items():
                    st.markdown(f"##### 🏷️ {_path} ({len(_plist)})")
                    for p in _plist:
                        with st.expander(f"{'✅' if p.get('verified') == 'Y' else '⏳'} [{p.get('difficulty', '')}] {p.get('source', '')} · {_short_q(p)}"):
                            render_bank_problem(p, "bf")
                if len(_bitems) < _bres["total"]:
                    if st.button("⬇️ 더 보기", key="bf_more"):
                        st.session_state.bf_limit += 30
                        st.rerun()

            with sub_tax:
                import pandas as pd
                if not _btax:
                    st.info("아직 유형표가 비어 있어요. 문제를 저장하면 자동으로 채워집니다.")
                else:
                    _tdf = pd.DataFrame(_btax)
                    for _c in ("count", "verified", "하", "중", "상"):
                        if _c not in _tdf:
                            _tdf[_c] = 0
                    _tdf = _tdf[["grade", "unit", "type", "frame", "count", "verified", "하", "중", "상", "description"]].rename(columns={
                        "grade": "학년", "unit": "단원", "type": "유형", "frame": "문제틀", "count": "문제 수",
                        "verified": "검수 완료", "description": "설명"})
                    _tdf = _tdf.sort_values(["학년", "단원", "유형", "문제틀"])
                    _few = st.number_input("검수 완료 문제가 이 개수보다 적은 문제틀만 보기 (0 = 전체)", min_value=0, value=0, step=1, key="tx_few")
                    if _few:
                        _tdf = _tdf[_tdf["검수 완료"] < _few]
                    st.dataframe(_tdf, use_container_width=True, hide_index=True)

                    st.markdown("##### ✏️ 이름 바꾸기 · 옮기기 · 합치기")
                    st.caption("바꿀 이름이 이미 있으면 두 묶음이 하나로 합쳐집니다. 그 아래 문제와 문제틀도 함께 옮겨져요.")
                    _lvl_label = st.radio("무엇을 바꿀까요?", [TAX_LABELS[lv] for lv in TAX_LEVELS], index=3, horizontal=True, key="tx_level")
                    _lvl = TAX_LEVELS[[TAX_LABELS[lv] for lv in TAX_LEVELS].index(_lvl_label)]
                    _lv_list = TAX_LEVELS[:TAX_LEVELS.index(_lvl) + 1]
                    st.markdown("바꿀 대상")
                    _old = taxonomy_picker("tx_old", _btax, allow_new=False, levels=_lv_list)
                    st.markdown("새 이름 / 옮길 위치")
                    _new = taxonomy_picker("tx_new", _btax, suggestion=_old, levels=_lv_list)
                    if st.session_state.get("tx_flash"):
                        st.success(st.session_state.pop("tx_flash"))
                    if st.button("적용하기", key="tx_apply"):
                        if not all(_new.get(lv) for lv in _lv_list):
                            st.warning("새 이름을 모두 입력해 주세요.")
                        elif all(_new.get(lv) == _old.get(lv) for lv in _lv_list):
                            st.info("바뀐 것이 없습니다.")
                        else:
                            _r = taxonomy_rename(_lvl, _old, _new)
                            if _r.get("ok"):
                                st.session_state["tx_flash"] = f"바꿨습니다. ({_r.get('changed', 0)}줄 변경)"
                                st.rerun()
                            else:
                                st.error(f"실패했습니다: {_r.get('error', '')}")

                    st.markdown("##### 📝 문제틀 설명 고치기")
                    _dsel = taxonomy_picker("tx_desc", _btax, allow_new=False)
                    _cur_desc = next((t.get("description", "") for t in _btax
                                      if all(t.get(lv) == _dsel.get(lv) for lv in TAX_LEVELS)), "")
                    _ndesc = st.text_input("설명", value=_cur_desc, key=f"tx_desc_text_{frame_path(_dsel)}")
                    if st.button("설명 저장", key="tx_desc_save"):
                        if taxonomy_upsert(_dsel.get("grade"), _dsel.get("unit"), _dsel.get("type"), _dsel.get("frame"), _ndesc):
                            st.success("저장했습니다.")
                            st.rerun()


# ------------------------------------------
# [선생님] 비슷한 문제 찾기: 새 문제 → AI가 문제틀을 찾고 → 문제 은행에서 골라 내기
# ------------------------------------------
if tab_similar is not None:
    with tab_similar:
        st.caption("학생이 틀린 문제를 올리면 AI가 같은 문제틀을 찾아, 문제 은행에 모아 둔 문제를 바로 골라 줍니다.")
        if not bank_backend_ready():
            st.warning(BANK_SETUP_MSG)
        else:
            _stax = taxonomy_list()
            _sfile = st.file_uploader("문제 사진", type=["png", "jpg", "jpeg"], key="sim_upload")
            if _sfile and st.button("📸 사진에서 글자 읽기", key="sim_ocr"):
                with st.spinner("문제를 읽는 중..."):
                    try:
                        st.session_state.sim_text = mathpix_ocr(_sfile.getvalue())
                        st.session_state.sim_ocr_n = st.session_state.get("sim_ocr_n", 0) + 1
                    except Exception as e:
                        safe_error("읽기에 실패했습니다.", e)
            _stext = st.text_area("문제 내용 (직접 입력하거나 고칠 수 있어요)", value=st.session_state.get("sim_text", ""), key=f"sim_text_area_{st.session_state.get('sim_ocr_n', 0)}", height=120)
            if _stext.strip() and st.button("🤖 AI로 문제틀 찾기", type="primary", key="sim_classify"):
                if not _stax:
                    st.warning("문제 은행이 아직 비어 있어요. 먼저 문제를 저장해 주세요.")
                else:
                    with st.spinner("AI가 같은 문제틀을 찾는 중..."):
                        try:
                            st.session_state.sim_result = classify_frame(_stext, _stax, gemini_api_key, get_gemini_model_name())
                            st.session_state.sim_ver = st.session_state.get("sim_ver", 0) + 1
                        except Exception as e:
                            safe_error("AI 분류에 실패했습니다.", e)

            _sres = st.session_state.get("sim_result")
            if _sres:
                if _sres.get("is_new_frame"):
                    st.info(f"🤖 딱 맞는 문제틀이 아직 없어요. 가장 가까운 유형: {_sres.get('grade')} › {_sres.get('unit')} › {_sres.get('type')}  (제안 이름: {_sres.get('frame')})")
                else:
                    st.success(f"🤖 찾은 문제틀: {frame_path(_sres)} · 이 문제 난이도 {_sres.get('difficulty', '')}")
                st.markdown("문제틀 확인 (다르면 바꿔 주세요)")
                _spick = taxonomy_picker(f"sim_pick_{st.session_state.get('sim_ver', 0)}", _stax, suggestion=_sres, allow_new=False)
                c1, c2, c3 = st.columns([1.4, 1, 1])
                with c1:
                    _sdiff = st.multiselect("난이도", DIFFICULTIES, default=DIFFICULTIES, key="sim_diff")
                with c2:
                    _sver = st.checkbox("검수 완료만", value=True, key="sim_ver_only")
                with c3:
                    _swide = st.checkbox("같은 유형 전체로 넓히기", key="sim_wide")
                _sfilter = {lv: _spick.get(lv) for lv in (TAX_LEVELS[:3] if _swide else TAX_LEVELS) if _spick.get(lv)}
                _found = bank_search(limit=100, difficulty=_sdiff, verified=_sver, **_sfilter)
                _fitems = _found["items"]
                st.caption(f"문제 은행에서 {_found['total']}문제를 찾았습니다.")
                if not _fitems:
                    st.info("조건에 맞는 문제가 없어요. '검수 완료만'을 끄거나 '같은 유형 전체로 넓히기'를 켜 보세요.")
                else:
                    _slabels = {f"[{p.get('difficulty', '')}] {p.get('frame', '')} · {_short_q(p)} [{p.get('id')}]": p for p in _fitems}
                    _ssel = st.multiselect("낼 문제 고르기", list(_slabels.keys()), default=list(_slabels.keys())[:4], key="sim_sel")
                    _chosen = [_slabels[k] for k in _ssel]
                    if _chosen:
                        st.download_button(f"📥 고른 {len(_chosen)}문제 학습지 받기",
                                           data=make_problem_sheet_html("비슷한 문제 연습", _chosen),
                                           file_name="비슷한문제_학습지.html", mime="text/html", key="sim_dl", type="primary")
                        if st.button(f"📝 고른 {len(_chosen)}문제 숙제 바구니에 담기", key="sim_to_cart"):
                            add_to_hw_cart(_chosen)
                        st.markdown("##### 미리 보기")
                        for i, p in enumerate(_chosen, start=1):
                            with st.container(border=True):
                                st.markdown(f"**[{i}]** · 난이도 {p.get('difficulty', '')}")
                                render_bank_problem(p, "sim", editable=False)


# ------------------------------------------
# [선생님] 📝 숙제: 숙제 내기 · 제출 현황(O/X 확인·수정)
# ------------------------------------------
def _hw_targets(hw, students):
    """숙제를 받는 학생 목록: 대상 학생이 있으면 그 학생들, 없으면 그 반 학생 전체."""
    ids = [x for x in hw.get("student_ids", "").split(",") if x]
    if ids:
        return ids
    return [s.get("student_id", "") for s in students if s.get("class_id", "") == hw.get("class_id", "")]


def _hw_label(hw):
    due = f" · 마감 {hw.get('due_date')}" if hw.get("due_date") else ""
    who = hw.get("student_ids") or (f"{hw.get('class_id')}반 전체" if hw.get("class_id") else "")
    return f"{hw.get('title', '숙제')}{due} · {who} · {len(hw.get('problem_ids', '').split(','))}문제"


_OX = {"Y": "O", "N": "X", "?": "?"}
_XO = {"O": "Y", "X": "N", "?": "?", "": ""}

if tab_hw is not None:
    with tab_hw:
        st.subheader("📝 숙제")
        if not hw_backend_ready():
            st.warning(HW_SETUP_MSG)
        else:
            sub_new, sub_status = st.tabs(["➕ 숙제 내기", "✅ 제출 현황·채점"])

            with sub_new:
                st.caption("단원을 골라 문제를 체크해 숙제 바구니에 담으세요. 문제 은행의 '문제 찾기'나 '비슷한 문제 찾기'에서 담은 문제도 여기에 모여요. "
                           "숙제는 문제를 복사하지 않고 문제 번호만 저장합니다.")
                _cart = st.session_state.setdefault("hw_cart", [])
                _citems = st.session_state.setdefault("hw_cart_items", {})
                with st.expander("📚 단원에서 문제 고르기", expanded=not _cart):
                    _htax = taxonomy_list()
                    _sem_map = unit_semesters()
                    _grades = sorted({t["grade"] for t in _htax if t.get("grade")})
                    if not _grades:
                        st.info("문제 은행에 아직 문제가 없어요.")
                    else:
                        _u1, _u2, _u3, _u4 = st.columns([1, 0.8, 1.5, 1.5])
                        with _u1:
                            _hg = st.selectbox("학년", _grades, key="hwu_grade")
                        with _u2:
                            _hs = st.selectbox("학기", ["전체"] + SEMESTERS, key="hwu_sem")
                        # 학기를 정하지 않은 단원은 어느 학기에서나 보인다
                        _units = sorted({t["unit"] for t in _htax if t.get("grade") == _hg and t.get("unit")
                                         and (_hs == "전체" or _sem_map.get((_hg, t["unit"]), _hs) == _hs)})
                        with _u3:
                            _hu = st.selectbox("단원", _units, key="hwu_unit") if _units else None
                        _htypes = sorted({t["type"] for t in _htax if t.get("grade") == _hg and t.get("unit") == _hu and t.get("type")})
                        with _u4:
                            _ht = st.selectbox("유형", ["전체"] + _htypes, key="hwu_type")
                        _d1, _d2 = st.columns([2, 1])
                        with _d1:
                            _hd = st.pills("난이도", DIFFICULTIES, selection_mode="multi", default=DIFFICULTIES, key="hwu_diff") or DIFFICULTIES
                        with _d2:
                            _hvonly = st.checkbox("검수 완료 문제만", value=True, key="hwu_ver", help="AI가 만든 정답이 틀렸을 수 있어서, 숙제에는 검수한 문제만 쓰는 것을 권해요.")
                        if not _hu:
                            st.caption("이 학년·학기에 단원이 없어요.")
                        else:
                            _hsig = (_hg, _hu, _ht, tuple(_hd), _hvonly)
                            if st.session_state.get("hwu_sig") != _hsig:
                                st.session_state.hwu_sig = _hsig
                                st.session_state.hwu_limit = 20
                            _hr = bank_search(limit=st.session_state.hwu_limit, grade=_hg, unit=_hu,
                                              type="" if _ht == "전체" else _ht,
                                              difficulty=list(_hd) if len(_hd) < len(DIFFICULTIES) else None, verified=_hvonly)
                            _hitems = _hr["items"]
                            st.caption(f"{_hr['total']}문제 중 {len(_hitems)}개 · 체크한 뒤 아래 '바구니에 담기'를 누르세요.")
                            for _hp in _hitems:
                                with st.container(border=True):
                                    _k1, _k2 = st.columns([0.7, 6])
                                    with _k1:
                                        st.checkbox("담기", value=_hp["id"] in _cart, key=f"hwu_pick_{_hp['id']}")
                                    with _k2:
                                        st.caption(f"{_hp.get('type', '')} › {_hp.get('frame', '')} · 난이도 {_hp.get('difficulty', '')}"
                                                   + (" · ✅검수" if _hp.get("verified") == "Y" else ""))
                                        st.markdown(format_math(_hp.get("question", "")), unsafe_allow_html=True)
                            _hb1, _hb2 = st.columns(2)
                            with _hb1:
                                if st.button("🧺 체크한 문제 바구니에 담기", type="primary", key="hwu_add"):
                                    add_to_hw_cart([_hp for _hp in _hitems if st.session_state.get(f"hwu_pick_{_hp['id']}")])
                                    st.rerun()
                            with _hb2:
                                if len(_hitems) < _hr["total"] and st.button("⬇️ 더 보기", key="hwu_more"):
                                    st.session_state.hwu_limit += 20
                                    st.rerun()
                if not _cart:
                    st.info("숙제 바구니가 비어 있어요.")
                else:
                    st.markdown(f"**숙제 바구니: {len(_cart)}문제**")
                    for _i, _pid in enumerate(list(_cart), start=1):
                        _p = _citems.get(_pid, {})
                        _c1, _c2 = st.columns([6, 1])
                        with _c1:
                            st.caption(f"[{_i}] {frame_path(_p)} · {_p.get('difficulty', '')} · {_short_q(_p, 50)}")
                        with _c2:
                            if st.button("빼기", key=f"hw_rm_{_pid}"):
                                _cart.remove(_pid)
                                st.rerun()
                    if st.button("🧹 바구니 비우기", key="hw_cart_clear"):
                        _cart.clear()
                        st.rerun()

                    st.divider()
                    _hv = st.session_state.get("hw_form_ver", 0)
                    _title = st.text_input("숙제 이름", value=f"{datetime.date.today():%m/%d} 숙제", key=f"hw_title_{_hv}")
                    _cA, _cB = st.columns(2)
                    with _cA:
                        _due = st.date_input("마감일", value=datetime.date.today() + datetime.timedelta(days=2), key=f"hw_due_{_hv}")
                    with _cB:
                        _cls = st.selectbox("반", class_list, key=f"hw_cls_{_hv}")
                    _cls_students = [s.get("student_id", "") for s in admin_list_students() if s.get("class_id", "") == _cls]
                    _who = st.radio("받는 학생", ["반 전체", "학생 골라서"], horizontal=True, key=f"hw_who_{_hv}")
                    _picked = []
                    if _who == "학생 골라서":
                        _all_ids = [s.get("student_id", "") for s in admin_list_students()]
                        _picked = st.multiselect("학생", _all_ids, default=_cls_students, key=f"hw_students_{_hv}")
                    _memo = st.text_input("메모 (선택)", key=f"hw_memo_{_hv}")
                    _probs = [_citems[i] for i in _cart if i in _citems]
                    _cS, _cP = st.columns(2)
                    with _cS:
                        if st.button("📝 숙제 내기", type="primary", key=f"hw_save_{_hv}"):
                            if _who == "학생 골라서" and not _picked:
                                st.warning("학생을 한 명 이상 골라 주세요.")
                            else:
                                _r = hw_save(_title.strip() or "숙제", _due.strftime("%Y-%m-%d"), _cls, _picked, _cart, _memo.strip())
                                if _r.get("ok"):
                                    st.session_state.hw_flash = f"✅ '{_title}' 숙제를 냈어요. ({len(_cart)}문제)"
                                    _cart.clear()
                                    st.session_state.hw_form_ver = _hv + 1
                                    st.rerun()
                                else:
                                    st.error(f"숙제를 저장하지 못했어요: {_r.get('error', '')}")
                    with _cP:
                        st.download_button("🖨️ 학습지 받기", data=make_problem_sheet_html(_title, _probs),
                                           file_name="숙제_학습지.html", mime="text/html", key=f"hw_print_{_hv}")
                if st.session_state.get("hw_flash"):
                    st.success(st.session_state.pop("hw_flash"))

            with sub_status:
                _hws = hw_list()
                if not _hws:
                    st.info("아직 낸 숙제가 없어요.")
                else:
                    _hmap = {_hw_label(h) + f" [{h['hw_id']}]": h for h in _hws}
                    _hsel = _hmap[st.selectbox("숙제 고르기 (최근 순)", list(_hmap.keys()), key="hw_status_pick")]
                    _hid = _hsel["hw_id"]
                    _pids = [x for x in _hsel.get("problem_ids", "").split(",") if x]
                    _pmap = bank_by_ids(_pids)
                    _targets = _hw_targets(_hsel, admin_list_students())
                    _res = hw_results(hw_id=_hid)
                    _cell = {(r["student_id"], r["problem_id"]): r for r in _res}
                    st.caption("O = 맞음, X = 틀림, ? = 정답이 없어 확인 필요. 칸을 고친 뒤 '채점 저장'을 누르세요. "
                               "종이로 걷은 숙제는 여기서 O/X만 넣어도 됩니다.")
                    import pandas as pd
                    _cols = [str(i) for i in range(1, len(_pids) + 1)]
                    _grid = []
                    for _sid in _targets:
                        _row = {"학생": _sid}
                        for _c, _pid in zip(_cols, _pids):
                            _row[_c] = _OX.get(_cell.get((_sid, _pid), {}).get("correct", ""), "")
                        _ok = sum(1 for _c in _cols if _row[_c] == "O")
                        _done = sum(1 for _c in _cols if _row[_c])
                        _row["점수"] = f"{_ok}/{len(_cols)}" if _done else "미제출"
                        _grid.append(_row)
                    if not _grid:
                        st.info("이 숙제를 받는 학생이 없어요.")
                    else:
                        _df = pd.DataFrame(_grid)
                        _edited = st.data_editor(
                            _df, hide_index=True, disabled=["학생", "점수"], key=f"hw_grid_{_hid}",
                            column_config={c: st.column_config.SelectboxColumn(c, options=["", "O", "X", "?"], width="small")
                                           for c in _cols})
                        if st.button("💾 채점 저장", type="primary", key=f"hw_grid_save_{_hid}"):
                            _fail = 0
                            for _, _er in _edited.iterrows():
                                _sid = _er["학생"]
                                _orig = next(g for g in _grid if g["학생"] == _sid)
                                _marks = [{"problem_id": _pid, "correct": _XO.get(_er[_c] or "", "")}
                                          for _c, _pid in zip(_cols, _pids) if (_er[_c] or "") != _orig[_c]]
                                if _marks and not hw_mark(_hid, _sid, _marks):
                                    _fail += 1
                            if _fail:
                                st.error(f"{_fail}명의 채점을 저장하지 못했어요.")
                            else:
                                st.success("채점을 저장했어요.")
                                st.rerun()
                        with st.expander("✍️ 학생이 낸 답 보기"):
                            _ans = pd.DataFrame([{"학생": _sid, **{_c: _cell.get((_sid, _pid), {}).get("answer", "")
                                                                   for _c, _pid in zip(_cols, _pids)}} for _sid in _targets])
                            st.dataframe(_ans, hide_index=True)
                        with st.expander("🏷️ 어려워한 문제 · 중요 문제 체크"):
                            if not tags_backend_ready():
                                st.info(TAGS_SETUP_MSG)
                            else:
                                st.caption("틀린 문제(X)는 채점에서 자동으로 '틀림'이 돼요. 여기서는 어려워한 문제와 중요한 문제를 골라 주세요. 둘 다 고를 수 있어요.")
                                _TOPT = ["", "어려워함", "중요", "어려워함·중요"]

                                def _tcell(v):
                                    return "·".join(t for t in tag_list(v) if t != "틀림")
                                _tgrid = [{"학생": _sid, **{_c: _tcell(_cell.get((_sid, _pid), {}).get("tags", ""))
                                                           for _c, _pid in zip(_cols, _pids)}} for _sid in _targets]
                                _tedit = st.data_editor(
                                    pd.DataFrame(_tgrid), hide_index=True, disabled=["학생"], key=f"hw_tgrid_{_hid}",
                                    column_config={c: st.column_config.SelectboxColumn(c, options=_TOPT, width="small") for c in _cols})
                                if st.button("💾 구분 저장", key=f"hw_tgrid_save_{_hid}"):
                                    _fail = 0
                                    for _, _er in _tedit.iterrows():
                                        _sid = _er["학생"]
                                        _orig = next(g for g in _tgrid if g["학생"] == _sid)
                                        _tg = [{"problem_id": _pid, "tags": ",".join(tag_list(str(_er[_c] or "").replace("·", ",")))}
                                               for _c, _pid in zip(_cols, _pids) if (_er[_c] or "") != _orig[_c]]
                                        if _tg and not hw_tag(_hid, _sid, _tg):
                                            _fail += 1
                                    if _fail:
                                        st.error(f"{_fail}명의 구분을 저장하지 못했어요.")
                                    else:
                                        st.success("구분을 저장했어요.")
                                        st.rerun()
                    with st.expander("📄 숙제 문제와 정답 보기"):
                        for _i, _pid in enumerate(_pids, start=1):
                            _p = _pmap.get(_pid)
                            if not _p:
                                st.caption(f"[{_i}] (문제 은행에서 지워진 문제)")
                                continue
                            st.markdown(f"**[{_i}]** {frame_path(_p)} · {_p.get('difficulty', '')}")
                            st.markdown(format_math(_p.get("question", "")), unsafe_allow_html=True)
                            st.markdown(f"정답: {format_math(_p.get('answer', ''))}", unsafe_allow_html=True)
                    if st.checkbox("이 숙제 삭제 (채점 기록도 함께 지워짐)", key=f"hw_del_chk_{_hid}"):
                        if st.button("🗑️ 숙제 삭제", key=f"hw_del_{_hid}"):
                            if hw_delete(_hid):
                                st.rerun()
                            else:
                                st.error("삭제하지 못했어요.")


# ------------------------------------------
# [학생] 📝 숙제: 번호별로 답을 넣고 제출하면 자동 채점
# ------------------------------------------
if tab_my_hw is not None:
    with tab_my_hw:
        st.subheader("📝 숙제")
        if not hw_backend_ready():
            st.info("선생님이 앱을 새 버전으로 바꾸면 숙제를 볼 수 있어요.")
        else:
            _myhws = hw_list(student_id=current_student_id, class_id=current_role if current_role != "미배정" else "")
            if not _myhws:
                st.info("아직 받은 숙제가 없어요.")
            else:
                _myres = hw_results(student_id=current_student_id)
                _by_hw = {}
                for r in _myres:
                    _by_hw.setdefault(r["hw_id"], {})[r["problem_id"]] = r

                def _my_hw_label(h):
                    n = len([x for x in h.get("problem_ids", "").split(",") if x])
                    done = _by_hw.get(h["hw_id"], {})
                    state = f"✅ 제출함 ({sum(1 for r in done.values() if r.get('correct') == 'Y')}/{n})" if done else "⏳ 아직 안 냄"
                    due = f" · 마감 {h.get('due_date')}" if h.get("due_date") else ""
                    return f"{h.get('title', '숙제')}{due} · {state}"

                _hm = {_my_hw_label(h) + f" [{h['hw_id']}]": h for h in _myhws}
                _h = _hm[st.selectbox("숙제 고르기", list(_hm.keys()), key="my_hw_pick")]
                _hid = _h["hw_id"]
                _pids = [x for x in _h.get("problem_ids", "").split(",") if x]
                _pmap = bank_by_ids(_pids)
                _done = _by_hw.get(_hid, {})
                if _h.get("memo"):
                    st.caption(f"📌 {_h['memo']}")
                if not _done:
                    st.caption("문제를 풀고 번호마다 답만 적어서 제출하세요. 제출하면 바로 채점돼요. (한 번만 낼 수 있어요)")
                    with st.form(f"my_hw_form_{_hid}"):
                        _answers = {}
                        for _i, _pid in enumerate(_pids, start=1):
                            _p = _pmap.get(_pid)
                            if not _p:
                                continue
                            st.markdown(f"**[{_i}]**")
                            st.markdown(format_math(_p.get("question", "")), unsafe_allow_html=True)
                            _answers[_pid] = st.text_input(f"{_i}번 답", key=f"my_hw_ans_{_hid}_{_pid}")
                            st.divider()
                        if st.form_submit_button("📨 제출하고 채점하기", type="primary"):
                            _sub = [{"problem_id": _pid, "answer": _a.strip(),
                                     "correct": grade_answer(_a, _pmap[_pid].get("answer", ""))}
                                    for _pid, _a in _answers.items()]
                            if hw_submit(_hid, current_student_id, _sub):
                                st.rerun()
                            else:
                                st.error("제출하지 못했어요. 잠시 후 다시 해 주세요.")
                else:
                    _ok = sum(1 for r in _done.values() if r.get("correct") == "Y")
                    st.success(f"제출 완료 · {_ok} / {len(_pids)} 맞았어요")
                    for _i, _pid in enumerate(_pids, start=1):
                        _p = _pmap.get(_pid)
                        if not _p:
                            continue
                        _r = _done.get(_pid, {})
                        _mark = {"Y": "⭕ 맞음", "N": "❌ 틀림", "?": "❔ 선생님 확인 중"}.get(_r.get("correct", ""), "－ 안 냄")
                        with st.container(border=True):
                            st.markdown(f"**[{_i}]** {_mark}")
                            st.markdown(format_math(_p.get("question", "")), unsafe_allow_html=True)
                            st.caption(f"내 답: {_r.get('answer', '') or '(빈칸)'}")
                            with st.expander("🔍 정답 및 풀이"):
                                st.markdown(f"**정답:** {format_math(_p.get('answer', ''))}", unsafe_allow_html=True)
                                if _p.get("solution"):
                                    st.markdown(f"**풀이:**\n\n{format_math(_p.get('solution', ''))}", unsafe_allow_html=True)


# ------------------------------------------
# [선생님] 📈 성적·리포트: 날짜별 점수(숙제는 자동), 학교 시험지 분석, 리포트 분석은 '만들기'를 누를 때만
# ------------------------------------------
def _hw_date(h):
    return h.get("due_date") or h.get("created_at", "")[:10]


def hw_scores(student_id, class_id=""):
    """학생이 받은 숙제별 점수 (날짜순). 학생이 제출하거나 선생님이 O/X를 저장하면 자동으로 잡힌다."""
    by_hw = {}
    for r in hw_results(student_id=student_id):
        by_hw.setdefault(r["hw_id"], []).append(r)
    rows = []
    for h in hw_list(student_id=student_id, class_id=class_id, limit=500):
        pids = [x for x in str(h.get("problem_ids", "")).split(",") if x]
        rs = by_hw.get(h["hw_id"], [])
        rows.append({"hw_id": h["hw_id"], "date": _hw_date(h), "title": h.get("title", ""), "total": len(pids),
                     "correct": sum(1 for r in rs if r.get("correct") == "Y"),
                     "pending": sum(1 for r in rs if r.get("correct") == "?"), "submitted": bool(rs)})
    return sorted(rows, key=lambda r: r["date"])


def _score_text(r):
    if not r["submitted"]:
        return "미제출"
    return f"{r['correct']} / {r['total']}" + (f" (❔{r['pending']})" if r["pending"] else "")


def _pct_text(r):
    return f"{r['correct'] / r['total'] * 100:.0f}%" if r["submitted"] and r["total"] else "-"


def _path(*parts):
    return " › ".join(str(x) for x in parts if x)


def student_history(student_id, class_id="", until=""):
    """학생이 지금까지 한 공부: 숙제 유형별 정답률, 받은 유사문제(어려워한 문제) 유형, 중요 체크한 유형."""
    hws = {h["hw_id"]: h for h in hw_list(limit=500)}
    res = [r for r in hw_results(student_id=student_id)
           if r["hw_id"] in hws and (not until or _hw_date(hws[r["hw_id"]]) <= until)]
    probs = bank_by_ids({r["problem_id"] for r in res})
    by_type = {}
    for r in res:
        p = probs.get(r["problem_id"])
        if r.get("correct") not in ("Y", "N") or not p:
            continue
        a = by_type.setdefault(_path(p.get("grade"), p.get("unit"), p.get("type")), [0, 0])
        a[0] += 1
        a[1] += r["correct"] == "Y"
    asked = [r for r in archive_stats(date_to=until) if r.get("student_id") == student_id]
    stars = {}
    if stars_backend_ready():
        for it in star_items(student_id):
            k = _path(it.get("grade"), it.get("unit"), it.get("subtype"))
            stars[k] = stars.get(k, 0) + 1
    _, tag_types = tag_summary(tagged_problems(student_id, date_to=until), top=40)
    return {"hw_by_type": by_type, "asked": asked, "stars": stars, "tag_types": tag_types}


def tagged_problems(student_id, date_from="", date_to="", limit=300):
    """구분(중요·틀림·어려워함)이 붙은 문제 목록: 보관함의 원본 문제·유사문제 1번·2번 + 숙제 문제.
    숙제에서 틀린(X) 문제는 따로 체크하지 않아도 '틀림'으로 넣는다."""
    out = []
    for a in archive_search(student=student_id, date_from=date_from, date_to=date_to, limit=limit)["items"]:
        path = _path(a.get("grade"), a.get("unit"), a.get("subtype"))
        mine = item_tags(a, student_id)
        for t, (src, qk) in zip(mine, (("원본 문제", "source_text"), ("유사문제 1번", "q1"), ("유사문제 2번", "q2"))):
            if t:
                out.append({"kind": "보관함", "src": src, "date": a.get("date", "")[:10], "path": path, "tags": t,
                            "text": a.get(qk, ""), "answer": "", "right": a.get("a1" if qk == "q1" else "a2" if qk == "q2" else "", "")})
    hws = {h["hw_id"]: h for h in hw_list(limit=500)}
    res = [r for r in hw_results(student_id=student_id) if r["hw_id"] in hws
           and (not date_from or _hw_date(hws[r["hw_id"]]) >= date_from) and (not date_to or _hw_date(hws[r["hw_id"]]) <= date_to)]
    res = [(r, tag_list(tag_list(r.get("tags")) + (["틀림"] if r.get("correct") == "N" else []))) for r in res]
    probs = bank_by_ids({r["problem_id"] for r, t in res if t})
    for r, t in res:
        p = probs.get(r["problem_id"])
        if t and p:
            out.append({"kind": "숙제", "src": hws[r["hw_id"]].get("title", "숙제"), "date": _hw_date(hws[r["hw_id"]]),
                        "path": _path(p.get("grade"), p.get("unit"), p.get("type")), "tags": t,
                        "text": p.get("question", ""), "answer": r.get("answer", ""), "right": p.get("answer", "")})
    return sorted(out, key=lambda e: e["date"], reverse=True)


def tag_summary(tagged, top=5):
    """구분별 개수 {구분: {'보관함': n, '숙제': n}} 와 구분별로 많이 나온 유형 {구분: [(유형, n)]}."""
    counts = {t: {"보관함": 0, "숙제": 0} for t in TAG_NAMES}
    types = {t: {} for t in TAG_NAMES}
    for e in tagged:
        for t in e["tags"]:
            counts[t][e["kind"]] += 1
            types[t][e["path"]] = types[t].get(e["path"], 0) + 1
    return counts, {t: sorted(d.items(), key=lambda x: -x[1])[:top] for t, d in types.items()}


def history_text(hist):
    lines = [f"- 숙제 | {k} | {c}/{n} 맞힘" for k, (n, c) in sorted(hist["hw_by_type"].items())]
    for r in sorted(hist["asked"], key=lambda r: -int(r.get("count") or 0))[:60]:
        lines.append(f"- 유사문제 받음 | {_path(r.get('grade'), r.get('unit'), r.get('subtype'))} | {r.get('count')}개")
    lines += [f"- 학생이 중요 체크 | {k} | {n}문제" for k, n in hist["stars"].items()]
    for t, rows in hist.get("tag_types", {}).items():
        lines += [f"- 선생님 구분 '{t}' | {k} | {n}문제" for k, n in rows]
    return "\n".join(lines) or "(아직 기록 없음)"


def _gemini_json(prompt):
    model = GeminiModel(gemini_api_key, get_gemini_model_name())
    text = model.generate_content(prompt).text
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {}


def analyze_school_exam(exam, images, wrong_text, hist):
    """학교 시험지 사진 → 문항별 단원·유형 분류 → 학원에서 한 공부 기록과 비교해 분석."""
    pages = []
    for i, b in enumerate(images, start=1):
        try:
            t = mathpix_ocr(b)
        except Exception:
            t = ""
        if t.strip():
            pages.append(f"[{i}쪽]\n{t}")
    if not pages:
        return {"error": "사진에서 글자를 읽지 못했어요. 시험지가 잘 보이게 다시 찍어 주세요."}
    wrong = sorted(set(re.findall(r"\d+", wrong_text or "")), key=int)
    prompt = f"""너는 대한민국 중·고등학교 수학 선생님이다. 아래는 학생이 본 학교 시험지를 글자로 읽은 것이다.
문항마다 단원·유형·난이도를 정하고, 이 학생이 학원에서 지금까지 한 공부 기록과 비교해 시험 결과를 분석해라.

[시험] {exam.get('date')} {exam.get('name')} · 점수 {exam.get('score')} / {exam.get('max_score')}
[틀린 문항 번호] {', '.join(wrong) if wrong else '(입력 안 함)'}

[학생의 지금까지 공부 기록] (구분 | 학년 › 단원 › 유형 | 결과)
{history_text(hist)}

[시험지]
{chr(10).join(pages)[:30000]}

[규칙]
- 시험지의 문항 번호 그대로, 모든 문항을 빠짐없이 적어라. 서술형은 번호 앞에 "서"를 붙여라 (예: "서1").
- related: 공부 기록에 같거나 비슷한 유형이 있으면 그 기록을 짧게 (예: "숙제 3/5 맞힘", "유사문제 4개 받음, 어려워함 2"), 없으면 "기록 없음".
- note: 이 문항의 핵심 개념이나 실수하기 쉬운 점을 한 줄로.
- summary: 틀린 문항과 공부 기록을 이어서 어떤 유형이 약했는지, 학원에서 연습한 유형은 잘 풀었는지, 연습하지 않은 유형이 얼마나 나왔는지 4~6문장. 틀린 번호가 없으면 출제 유형과 공부 기록의 빈 곳 위주로.
- advice: 다음 시험까지 할 공부 3가지, 줄마다 "- "로 시작.
- 기록에 없는 사실은 지어내지 말 것.
- 출력은 JSON만: {{"problems": [{{"no": "1", "unit": "...", "type": "...", "difficulty": "하|중|상", "related": "...", "note": "..."}}], "summary": "...", "advice": "..."}}"""
    try:
        out = _gemini_json(prompt)
    except Exception as e:
        return {"error": f"AI 분석을 하지 못했어요: {_mask_secrets(e)}"}
    probs = [p for p in out.get("problems", []) if isinstance(p, dict)]
    if not probs:
        return {"error": "시험지에서 문항을 찾지 못했어요. 사진을 다시 확인해 주세요."}
    for p in probs:
        no = re.sub(r"\D", "", str(p.get("no", "")))
        p["result"] = ("틀림" if no in wrong else "맞음") if wrong else ""
    return {"problems": probs, "summary": str(out.get("summary", "")), "advice": str(out.get("advice", "")),
            "wrong": wrong, "analyzed_at": datetime.date.today().isoformat()}


def show_exam_analysis(a):
    st.dataframe([{"번호": p.get("no", ""), "결과": p.get("result") or "-", "단원": p.get("unit", ""),
                   "유형": p.get("type", ""), "난이도": p.get("difficulty", ""),
                   "학원 공부 기록": p.get("related", ""), "메모": p.get("note", "")} for p in a.get("problems", [])],
                 hide_index=True, width="stretch")
    if a.get("summary"):
        st.markdown("**분석**")
        st.write(a["summary"])
    if a.get("advice"):
        st.markdown("**앞으로 할 공부**")
        st.markdown(a["advice"])


def build_student_report(student_id, date_from, date_to, class_id=""):
    """기간 안의 숙제 채점 결과 · 어려워한 문제 · 중요 체크 · 시험(시험지 분석 포함)으로 리포트 데이터를 만든다 (버튼을 눌렀을 때만)."""
    d_from, d_to = date_from.strftime("%Y-%m-%d"), date_to.strftime("%Y-%m-%d")
    hws = {h["hw_id"]: h for h in hw_list(limit=500)}
    results = [r for r in hw_results(student_id=student_id)
               if r["hw_id"] in hws and d_from <= _hw_date(hws[r["hw_id"]]) <= d_to]
    scores = [r for r in hw_scores(student_id, class_id) if d_from <= r["date"] <= d_to]
    probs = bank_by_ids({r["problem_id"] for r in results})
    graded = [r for r in results if r.get("correct") in ("Y", "N")]

    def tally(keyfn):
        t = {}
        for r in graded:
            p = probs.get(r["problem_id"])
            if not p:
                continue
            a = t.setdefault(keyfn(p), [0, 0])
            a[0] += 1
            a[1] += r["correct"] == "Y"
        return t

    by_unit = tally(lambda p: _path(p.get("grade"), p.get("unit")))
    by_type = tally(lambda p: _path(p.get("unit"), p.get("type")))
    weak = sorted(((k, n, c) for k, (n, c) in by_type.items() if n >= 2 and c / n < 0.8),
                  key=lambda x: (x[2] / x[1], -x[1]))[:5]
    wrong = []
    for r in sorted(results, key=lambda r: _hw_date(hws[r["hw_id"]]), reverse=True):
        if r.get("correct") == "N" and probs.get(r["problem_id"]):
            wrong.append({"date": _hw_date(hws[r["hw_id"]]), "problem": probs[r["problem_id"]], "answer": r.get("answer", "")})
    tagged = tagged_problems(student_id, d_from, d_to)
    tag_counts, tag_types = tag_summary(tagged)
    starred = star_items(student_id)[:20] if stars_backend_ready() else []
    exams = sorted((e for e in exam_list(student_id) if d_from <= e.get("date", "") <= d_to), key=lambda e: e.get("date", ""))
    return {
        "student_id": student_id, "from": d_from, "to": d_to,
        "hw_given": len(scores), "hw_done": sum(1 for r in scores if r["submitted"]), "hw_scores": scores,
        "solved": len(graded), "correct": sum(1 for r in graded if r["correct"] == "Y"),
        "by_unit": sorted(by_unit.items()), "weak": weak, "wrong": wrong[:15],
        "tagged": tagged, "tag_counts": tag_counts, "tag_types": tag_types, "starred": starred, "exams": exams,
    }


def _short(text, n=250):
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    return t if len(t) <= n else t[:n] + "…"


def report_ai_analysis(rep):
    """틀린 숙제 문제 · 어려워한 문제 · 중요 체크 · 숙제 점수 · 시험 분석을 읽고 '문제 분석'과 '종합 의견' 초안을 만든다."""
    rate = f"{rep['correct'] / rep['solved'] * 100:.0f}%" if rep["solved"] else "기록 없음"
    scores = "\n".join(f"- {r['date']} {r['title']}: {_score_text(r)}" for r in rep["hw_scores"]) or "(없음)"
    weak = ", ".join(f"{k} {c}/{n}" for k, n, c in rep["weak"]) or "뚜렷한 약점 없음"
    tagged = []
    for t in TAG_NAMES:
        c = rep["tag_counts"][t]
        es = [e for e in rep["tagged"] if t in e["tags"]]
        tagged.append(f"- '{t}' 문제 (보관함 {c['보관함']}개, 숙제 {c['숙제']}개):")
        for e in es[:12]:
            extra = f" | 학생 답: {e['answer'] or '(빈칸)'} | 정답: {_short(e['right'], 60)}" if e["kind"] == "숙제" else ""
            also = [x for x in e["tags"] if x != t]
            tagged.append(f"  · [{e['date']}] {e['kind']}·{e['src']} | {e['path']} | {_short(e['text'], 200)}{extra}"
                          + (f" | 함께 표시: {', '.join(also)}" if also else ""))
        if not es:
            tagged.append("  · (없음)")
    tagged = "\n".join(tagged)
    starred = "\n".join(f"- {_path(a.get('grade'), a.get('unit'), a.get('subtype'))} | {_short(a.get('q1'), 150)}"
                        for a in rep["starred"]) or "(없음)"
    exams = []
    for e in rep["exams"]:
        line = f"- {e.get('date')} {e.get('kind')} {e.get('name')} {e.get('score')}/{e.get('max_score')}"
        an = exam_analysis_of(e)
        if an.get("summary"):
            line += f"\n  시험지 분석: {_short(an['summary'], 600)}"
            bad = [f"{p.get('no')}번 {p.get('type', '')}" for p in an.get("problems", []) if p.get("result") == "틀림"]
            if bad:
                line += f"\n  틀린 문항: {', '.join(bad)}"
        exams.append(line)
    prompt = f"""너는 수학 학원 선생님이다. 아래 기록을 읽고 학부모님께 보낼 학습 리포트의 '문제 분석'과 '선생님 종합 의견'을 써라.
- 기간: {rep['from']} ~ {rep['to']}
- 숙제: {rep['hw_given']}번 중 {rep['hw_done']}번 제출, 채점된 문제 {rep['solved']}개, 정답률 {rate}
- 날짜별 숙제 점수:
{scores}
- 정답률이 낮은 유형 (맞힌 수/푼 수): {weak}
- 선생님이 구분한 문제 (한 문제에 여러 구분이 겹칠 수 있음. 숙제에서 틀린 문제는 자동으로 '틀림'):
{tagged}
- 학생이 직접 중요 체크한 문제:
{starred}
- 시험:
{chr(10).join(exams) or '(없음)'}

[규칙]
- analysis: 아래 다섯 칸을 이 순서로, 칸마다 1~3줄. 칸 제목은 그대로 쓰고 내용 줄은 "- "로 시작.
  ■ 자주 틀리는 유형 ('틀림' 문제 근거)
  ■ 어려워하는 유형 ('어려워함' 문제 근거. '틀림'과 겹치면 개념 부족, 맞혔지만 어려워했으면 아직 익숙하지 않은 것으로 구분)
  ■ 꼭 잡아야 할 중요 문제 ('중요' 문제가 어떤 유형인지, 그중 틀리거나 어려워한 것)
  ■ 시험과 연결해 본 점
  ■ 앞으로의 지도 계획 (틀린 원인이 개념 이해 / 계산 실수 / 문제 해석 중 무엇인지 학생 답을 근거로)
- comment: 학부모님께 드리는 존댓말 4~6문장. 잘한 점 → 보완할 점 → 지도 계획 순서.
- 기록에 없는 내용은 지어내지 말 것. 기록이 없는 칸은 "- 이번 기간에는 기록이 없습니다."
- 출력은 JSON만: {{"analysis": "...", "comment": "..."}}"""
    try:
        out = _gemini_json(prompt)
        return {"analysis": str(out.get("analysis", "")).strip(), "comment": str(out.get("comment", "")).strip()}
    except Exception as e:
        return {"analysis": f"(AI 분석을 만들지 못했어요: {_mask_secrets(e)})", "comment": ""}


def make_report_html(rep, comment, analysis=""):
    def esc(x):
        return html.escape(str(x or ""))
    rate = f"{rep['correct'] / rep['solved'] * 100:.0f}%" if rep["solved"] else "-"
    score_rows = "".join(f"<tr><td>{esc(r['date'])}</td><td>{esc(r['title'])}</td><td>{esc(_score_text(r))}</td>"
                         f"<td>{_pct_text(r)}</td></tr>"
                         for r in rep["hw_scores"]) or "<tr><td colspan=4>기간 안의 숙제가 없습니다.</td></tr>"
    unit_rows = "".join(f"<tr><td>{esc(k)}</td><td>{n}</td><td>{c}</td><td>{c / n * 100:.0f}%</td></tr>"
                        for k, (n, c) in rep["by_unit"]) or "<tr><td colspan=4>기록 없음</td></tr>"
    weak_rows = "".join(f"<tr><td>{esc(k)}</td><td>{c}/{n}</td><td>{c / n * 100:.0f}%</td></tr>"
                        for k, n, c in rep["weak"]) or "<tr><td colspan=3>뚜렷한 약점 유형이 없습니다.</td></tr>"
    exam_rows = "".join(f"<tr><td>{esc(e.get('date'))}</td><td>{esc(e.get('kind'))}</td><td>{esc(e.get('name'))}</td>"
                        f"<td>{esc(e.get('score'))} / {esc(e.get('max_score'))}</td><td>{esc(e.get('memo'))}</td></tr>"
                        for e in rep["exams"]) or "<tr><td colspan=5>기간 안의 시험 기록이 없습니다.</td></tr>"
    exam_an = ""
    for e in rep["exams"]:
        an = exam_analysis_of(e)
        if not an.get("problems"):
            continue
        rows = "".join(f"<tr><td>{esc(p.get('no'))}</td><td>{esc(p.get('result') or '-')}</td><td>{esc(_path(p.get('unit'), p.get('type')))}</td>"
                       f"<td>{esc(p.get('difficulty'))}</td><td>{esc(p.get('related'))}</td></tr>" for p in an["problems"])
        exam_an += (f"<h3>{esc(e.get('date'))} {esc(e.get('name'))} ({esc(e.get('score'))} / {esc(e.get('max_score'))})</h3>"
                    f"<table><tr><th>번호</th><th>결과</th><th>단원 › 유형</th><th>난이도</th><th>학원 공부 기록</th></tr>{rows}</table>"
                    f"<div class='comment'>{esc(an.get('summary'))}\n\n{esc(an.get('advice'))}</div>")
    if exam_an:
        exam_an = "<h2>학교 시험 분석</h2>" + exam_an
    wrong_rows = "".join(f"<div class='wrong'><div class='meta'>{esc(w['date'])} · {esc(w['problem'].get('unit', ''))}</div>"
                         f"<div>{format_math(w['problem'].get('question', ''))}</div>"
                         f"<div class='meta'>학생 답: {esc(w['answer']) or '(빈칸)'} · 정답: {format_math(w['problem'].get('answer', ''))}</div></div>"
                         for w in rep["wrong"]) or "<p>틀린 문제가 없습니다.</p>"
    tag_rows = "".join(f"<tr><td>{TAG_ICON[t]} {t}</td><td>{rep['tag_counts'][t]['보관함']}</td><td>{rep['tag_counts'][t]['숙제']}</td>"
                       f"<td>{esc(', '.join(f'{k} ({n})' for k, n in rep['tag_types'][t])) or '-'}</td></tr>" for t in TAG_NAMES)
    analysis_html = f"<h2>문제 분석</h2><div class='comment'>{esc(analysis)}</div>" if str(analysis or "").strip() else ""
    return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>{esc(rep['student_id'])} 학습 리포트</title>
<script>window.MathJax = {{ tex: {{ inlineMath: [['$', '$'], ['\\\\(', '\\\\)']] }} }};</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
<style>
@page {{ size: A4 portrait; margin: 12mm 14mm; }}
body {{ font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #111; max-width: 820px; margin: 0 auto; padding: 10px; font-size: 13.5px; }}
h1 {{ font-size: 20px; border-bottom: 2px solid #000; padding-bottom: 6px; }}
h2 {{ font-size: 15px; margin-top: 22px; border-left: 4px solid #333; padding-left: 8px; }}
h3 {{ font-size: 13.5px; margin: 14px 0 4px; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 6px; }}
th, td {{ border: 1px solid #ccc; padding: 5px 8px; text-align: left; }}
th {{ background: #f3f3f3; }}
.kpi {{ display: flex; gap: 12px; }} .kpi div {{ flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 8px; text-align: center; }}
.kpi b {{ display: block; font-size: 20px; }}
.wrong {{ border-bottom: 1px dashed #bbb; padding: 6px 0; }} .meta {{ color: #666; font-size: 12px; }}
.comment {{ white-space: pre-wrap; line-height: 1.7; border: 1px solid #ccc; border-radius: 6px; padding: 10px; margin-top: 6px; }}
.bar {{ text-align: center; margin-bottom: 12px; }} @media print {{ .bar {{ display: none; }} }}
</style></head><body>
<div class="bar"><button onclick="window.print()" style="padding:8px 20px;">🖨️ 인쇄 / PDF로 저장</button></div>
<h1>📊 {esc(rep['student_id'])} 학생 수학 학습 리포트</h1>
<div class="meta">기간: {esc(rep['from'])} ~ {esc(rep['to'])}</div>
<h2>숙제</h2>
<div class="kpi"><div>낸 숙제<b>{rep['hw_done']} / {rep['hw_given']}</b></div><div>푼 문제<b>{rep['solved']}</b></div><div>정답률<b>{rate}</b></div></div>
<h2>날짜별 숙제 점수</h2><table><tr><th>날짜</th><th>숙제</th><th>점수</th><th>정답률</th></tr>{score_rows}</table>
<h2>단원별 정답률</h2><table><tr><th>단원</th><th>푼 문제</th><th>맞힌 문제</th><th>정답률</th></tr>{unit_rows}</table>
<h2>보완이 필요한 유형</h2><table><tr><th>유형</th><th>맞힌/푼</th><th>정답률</th></tr>{weak_rows}</table>
<h2>문제 구분 현황</h2><table><tr><th>구분</th><th>보관함 문제</th><th>숙제 문제</th><th>많이 나온 유형</th></tr>{tag_rows}</table>
<h2>시험 성적</h2><table><tr><th>날짜</th><th>구분</th><th>시험</th><th>점수</th><th>메모</th></tr>{exam_rows}</table>
{exam_an}
{analysis_html}
<h2>선생님 종합 의견</h2><div class="comment">{esc(comment)}</div>
<h2>최근 틀린 문제</h2>{wrong_rows}
</body></html>"""


if tab_report is not None:
    with tab_report:
        st.subheader("📈 성적·리포트")
        if not hw_backend_ready():
            st.warning(HW_SETUP_MSG)
        else:
            _students = admin_list_students()
            _rc1, _rc2 = st.columns(2)
            with _rc1:
                _rcls_pick = st.selectbox("반", ["전체"] + class_list, key="rp_class")
            _stu_ids = [s.get("student_id", "") for s in _students
                        if _rcls_pick == "전체" or s.get("class_id", "") == _rcls_pick]
            if not _stu_ids:
                st.info("이 반에 학생이 없어요." if _rcls_pick != "전체" else "아직 가입한 학생이 없어요.")
            else:
                with _rc2:
                    _rs = st.selectbox("학생", _stu_ids, key="rp_student")
                _rcls = next((s.get("class_id", "") for s in _students if s.get("student_id") == _rs), "")
                sub_score, sub_exam, sub_rep = st.tabs(["📅 날짜별 점수", "📝 시험 점수·시험지 분석", "📄 학부모 리포트"])
                with sub_score:
                    st.caption("숙제 점수는 학생이 답을 제출하거나 선생님이 O/X를 저장하면 자동으로 들어와요. ❔는 선생님 확인이 필요한 문제 수예요.")
                    _scores = hw_scores(_rs, _rcls)
                    _exs_all = exam_list(_rs)
                    _table = [{"날짜": r["date"], "구분": "숙제", "이름": r["title"], "점수": _score_text(r),
                               "정답률(%)": round(r["correct"] / r["total"] * 100) if r["submitted"] and r["total"] else None}
                              for r in _scores]
                    for _e in _exs_all:
                        try:
                            _pct = round(float(_e.get("score")) / float(_e.get("max_score")) * 100)
                        except (TypeError, ValueError, ZeroDivisionError):
                            _pct = None
                        _table.append({"날짜": _e.get("date", ""), "구분": f"{_e.get('kind', '')} 시험", "이름": _e.get("name", ""),
                                       "점수": f"{_e.get('score')} / {_e.get('max_score')}", "정답률(%)": _pct})
                    if not _table:
                        st.info("아직 숙제나 시험 기록이 없어요.")
                    else:
                        import pandas as pd
                        _df = pd.DataFrame(_table).sort_values("날짜")
                        _chart = _df.dropna(subset=["정답률(%)"])
                        if not _chart.empty:
                            st.line_chart(_chart.pivot_table(index="날짜", columns="구분", values="정답률(%)", aggfunc="mean"),
                                          y_label="정답률(%)")
                        st.dataframe(_df.iloc[::-1], hide_index=True, width="stretch")
                with sub_exam:
                    _ev = st.session_state.get("ex_ver", 0)
                    with st.form(f"exam_form_{_ev}"):
                        _e1, _e2, _e3 = st.columns([1, 1, 2])
                        with _e1:
                            _ed = st.date_input("날짜", value=datetime.date.today())
                        with _e2:
                            _ek = st.selectbox("구분", ["학원", "학교"])
                        with _e3:
                            _en = st.text_input("시험 이름", placeholder="예: 2학기 중간고사, 10월 단원평가")
                        _e4, _e5, _e6 = st.columns([1, 1, 2])
                        with _e4:
                            _esc = st.number_input("점수", min_value=0.0, step=1.0)
                        with _e5:
                            _emx = st.number_input("만점", min_value=1.0, value=100.0, step=1.0)
                        with _e6:
                            _emm = st.text_input("메모 (선택)")
                        if st.form_submit_button("➕ 점수 저장", type="primary"):
                            if not _en.strip():
                                st.warning("시험 이름을 적어 주세요.")
                            elif exam_save(_rs, _ed.strftime("%Y-%m-%d"), _ek, _en.strip(), f"{_esc:g}", f"{_emx:g}", _emm.strip()):
                                st.session_state.ex_ver = _ev + 1
                                st.rerun()
                            else:
                                st.error("저장하지 못했어요.")
                    st.caption("학교 시험은 점수를 저장한 뒤, 아래 목록에서 시험지 사진을 올리면 지금까지 공부한 문제와 비교해 분석해요.")
                    _exs = sorted(exam_list(_rs), key=lambda e: e.get("date", ""), reverse=True)
                    if not _exs:
                        st.caption("아직 입력한 시험 점수가 없어요.")
                    for _e in _exs:
                        _eid = _e.get("id")
                        _x1, _x2 = st.columns([6, 1])
                        with _x1:
                            st.markdown(f"**{_e.get('date')}** · {_e.get('kind')} · {_e.get('name')} · **{_e.get('score')} / {_e.get('max_score')}**"
                                        + (f" · {_e.get('memo')}" if _e.get("memo") else ""))
                        with _x2:
                            if st.button("삭제", key=f"ex_del_{_eid}"):
                                exam_delete(_eid)
                                st.rerun()
                        if _e.get("kind") != "학교":
                            continue
                        _an = exam_analysis_of(_e)
                        with st.expander("🔎 시험지 분석 보기" if _an.get("problems") else "📸 시험지 사진 올려 분석하기"):
                            if _an.get("problems"):
                                show_exam_analysis(_an)
                                st.caption(f"{_an.get('analyzed_at', '')} 분석 · 다시 분석하려면 아래에 사진을 다시 올리세요.")
                            if backend_version() < 4:
                                st.info("시험지 분석을 저장하려면 저장소의 apps_script/Code.gs로 Apps Script를 바꾸고 '새 버전'으로 재배포해 주세요.")
                                continue
                            _imgs = st.file_uploader("시험지 사진 (여러 장 올릴 수 있어요)", type=["png", "jpg", "jpeg"],
                                                     accept_multiple_files=True, key=f"ex_up_{_eid}")
                            _wn = st.text_input("틀린 문항 번호 (예: 3, 7, 12 · 비워 두면 문항 분류만)",
                                                value=", ".join(_an.get("wrong", [])), key=f"ex_wrong_{_eid}")
                            if st.button("🔎 분석하기", type="primary", key=f"ex_an_{_eid}"):
                                if not _imgs:
                                    st.warning("시험지 사진을 올려 주세요.")
                                else:
                                    with st.spinner("시험지를 읽고 지금까지 공부한 문제와 비교하는 중..."):
                                        _hist = student_history(_rs, _rcls, until=_e.get("date", ""))
                                        _res = analyze_school_exam(_e, [f.getvalue() for f in _imgs], _wn, _hist)
                                    if _res.get("error"):
                                        st.error(_res["error"])
                                    elif exam_set_analysis(_eid, _res):
                                        st.rerun()
                                    else:
                                        st.error("분석 결과를 저장하지 못했어요.")
                with sub_rep:
                    st.caption("'리포트 만들기'를 누를 때만 분석해요. 기간 안의 숙제 점수, 중요·틀림·어려워함으로 구분한 문제(보관함 원본·유사문제, 숙제), 학생이 중요 체크한 문제, 시험 점수와 시험지 분석을 모아요.")
                    _r1, _r2 = st.columns([2, 1])
                    with _r1:
                        _rrange = st.date_input("기간", value=(datetime.date.today() - datetime.timedelta(days=30), datetime.date.today()),
                                                key="rp_range")
                    with _r2:
                        _rai = st.checkbox("AI 문제 분석·종합 의견 넣기", value=True, key="rp_ai")
                    if st.button("📄 리포트 만들기", type="primary", key="rp_make"):
                        if not (isinstance(_rrange, (tuple, list)) and len(_rrange) == 2):
                            st.warning("기간의 시작일과 끝일을 모두 골라 주세요.")
                        else:
                            with st.spinner("숙제·어려워한 문제·시험 기록을 분석하는 중..."):
                                _rep = build_student_report(_rs, _rrange[0], _rrange[1], _rcls)
                                _ai = report_ai_analysis(_rep) if _rai else {"analysis": "", "comment": ""}
                            st.session_state.rp_data = _rep
                            _sfx = f"{_rs}_{_rep['from']}_{_rep['to']}"
                            st.session_state[f"rp_analysis_{_sfx}"] = _ai["analysis"]
                            st.session_state[f"rp_comment_{_sfx}"] = _ai["comment"]
                    _rep = st.session_state.get("rp_data")
                    if _rep and _rep["student_id"] == _rs:
                        _rate = f"{_rep['correct'] / _rep['solved'] * 100:.0f}%" if _rep["solved"] else "-"
                        _k1, _k2, _k3, _k4 = st.columns(4)
                        _k1.metric("낸 숙제", f"{_rep['hw_done']} / {_rep['hw_given']}")
                        _k2.metric("푼 문제", _rep["solved"])
                        _k3.metric("정답률", _rate)
                        _k4.metric("어려워한 문제", sum(_rep["tag_counts"]["어려워함"].values()))
                        st.markdown("**문제 구분 현황** (한 문제가 여러 구분에 겹칠 수 있어요)")
                        st.dataframe([{"구분": f"{TAG_ICON[t]} {t}", "보관함": _rep["tag_counts"][t]["보관함"], "숙제": _rep["tag_counts"][t]["숙제"],
                                       "많이 나온 유형": ", ".join(f"{k} ({n})" for k, n in _rep["tag_types"][t])} for t in TAG_NAMES],
                                     hide_index=True, width="stretch")
                        if _rep["weak"]:
                            st.markdown("**보완이 필요한 유형**")
                            for _k, _n, _c in _rep["weak"]:
                                st.markdown(f"- {_k}: {_c}/{_n} ({_c / _n * 100:.0f}%)")
                        _sfx = f"{_rs}_{_rep['from']}_{_rep['to']}"
                        _analysis = st.text_area("문제 분석 (고쳐서 쓰세요)", key=f"rp_analysis_{_sfx}", height=220)
                        _comment = st.text_area("선생님 종합 의견 (고쳐서 쓰세요)", key=f"rp_comment_{_sfx}", height=160)
                        st.download_button("📥 학부모 리포트 받기 (인쇄·PDF 저장)", data=make_report_html(_rep, _comment, _analysis),
                                           file_name=f"{_rs}_학습리포트_{_rep['to']}.html", mime="text/html",
                                           type="primary", key="rp_dl")
