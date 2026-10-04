import streamlit as st
import requests
import json
import base64
import re
import os
import time
import datetime
import io
import hashlib
import hmac
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
import google.generativeai as genai

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
        params = {"t": int(time.time() * 1000)}
        if sheet_api_token:
            params["token"] = sheet_api_token
        if class_id:
            params["class_id"] = class_id
        if since_date:
            params["since"] = since_date
        res = requests.get(sheet_url, params=params, timeout=30)
        if res.status_code == 200:
            data = res.json()
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
        st.error(f"데이터베이스 연결 오류: {e}")
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
        return res.status_code == 200
    except Exception as e:
        st.error(f"과제 등록 오류: {e}")
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
        return res.status_code == 200
    except Exception as e:
        st.error(f"과제 삭제 오류: {e}")
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


def _post_action(payload):
    """Apps Script에 action 기반 POST 요청을 보내는 공통 헬퍼 (계정/보관함용)."""
    if not sheet_url:
        return {"ok": False, "error": "로컬 모드에서는 계정 기능을 사용할 수 없습니다."}
    try:
        payload = dict(payload)
        payload["_token"] = sheet_api_token
        res = requests.post(sheet_url, json=payload, timeout=15)
        if res.status_code == 200:
            return res.json()
        return {"ok": False, "error": f"서버 오류 (status {res.status_code})"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def student_signup(student_id, password):
    """학생 회원가입. 반은 아직 배정되지 않은 상태(class_id="")로 생성됨."""
    return _post_action({
        "action": "signup",
        "student_id": student_id.strip(),
        "password_hash": hash_password(password),
    })


def student_login(student_id, password):
    """학생 로그인. 성공하면 {'ok': True, 'class_id': ...} 반환."""
    return _post_action({
        "action": "login",
        "student_id": student_id.strip(),
        "password_hash": hash_password(password),
    })


def admin_assign_class(student_id, class_id):
    """관리자가 특정 학생에게 반을 배정."""
    result = _post_action({
        "action": "assign_class",
        "student_id": student_id,
        "class_id": class_id,
    })
    return bool(result.get("ok"))


def student_withdraw(student_id, password):
    """학생 본인 탈퇴 - 비밀번호 재확인 필요. 계정+개인보관함이 함께 삭제됨."""
    return _post_action({
        "action": "withdraw",
        "student_id": student_id,
        "password_hash": hash_password(password),
        "by_admin": False,
    })


def admin_withdraw_student(student_id):
    """관리자가 특정 학생을 강제 탈퇴 - 비밀번호 확인 없이 즉시 처리. 계정+개인보관함이 함께 삭제됨."""
    result = _post_action({
        "action": "withdraw",
        "student_id": student_id,
        "by_admin": True,
    })
    return bool(result.get("ok"))


def admin_list_students():
    """관리자용 - 전체 학생 아이디와 배정된 반 목록 (비밀번호 해시는 절대 포함 안 됨)."""
    if not sheet_url:
        return []
    try:
        params = {"action": "list_students", "t": int(time.time() * 1000)}
        if sheet_api_token:
            params["token"] = sheet_api_token
        res = requests.get(sheet_url, params=params, timeout=15)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list):
                return data
    except Exception as e:
        st.error(f"학생 목록 조회 오류: {e}")
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
        st.error(f"보관함 조회 오류: {e}")
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
    if not sheet_url:
        if os.path.exists(STATUS_FILE):
            with open(STATUS_FILE, "r") as f:
                return f.read().strip()
        return "OFF"
    try:
        params = {"action": "get_status", "t": int(time.time() * 1000)}
        if sheet_api_token:
            params["token"] = sheet_api_token
        res = requests.get(sheet_url, params=params, timeout=10)
        if res.status_code == 200:
            data = res.json()
            return data.get("status", "OFF")
    except Exception:
        pass
    return "OFF"

def set_app_status(status):
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
        params = dict(params)
        params["t"] = int(time.time() * 1000)
        if sheet_api_token:
            params["token"] = sheet_api_token
        res = requests.get(sheet_url, params=params, timeout=timeout)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        st.error(f"보관함 조회 오류: {e}")
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
# ★ 문제 은행 (Apps Script 'bank' 탭 + 'taxonomy' 탭)
# 문제를 학생과 상관없이 한 문제씩 저장한다.
# 분류: 학년 › 단원 › 유형 › 문제틀(숫자·난이도만 다른 문제들의 묶음) + 난이도(하/중/상) + 검수 표시
# ==========================================
TAX_LEVELS = ["grade", "unit", "type", "frame"]
TAX_LABELS = {"grade": "학년", "unit": "단원", "type": "유형", "frame": "문제틀"}
DIFFICULTIES = ["하", "중", "상"]
NEW_OPTION = "＋ 새로 입력"


def bank_search(limit=50, offset=0, **filters):
    """문제 은행 검색. filters: grade, unit, type, frame, difficulty(list), verified(bool), source, keyword, ids(list)."""
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
    data = _get_action({"action": "taxonomy"})
    if not isinstance(data, list):
        return []
    return [t for t in data if isinstance(t, dict) and "frame" in t]


@st.cache_data(ttl=60, show_spinner=False)
def bank_backend_ready():
    """Apps Script가 문제 은행 기능이 있는 버전인지 확인."""
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


def bank_save(problems, image_b64=""):
    result = _post_action({"action": "bank_save", "group_id": str(int(time.time() * 1000)),
                           "problems": problems, "image_b64": image_b64 or ""})
    if result.get("ok"):
        _bank_changed()
    return result


def bank_update(prob_id, **fields):
    result = _post_action({"action": "bank_update", "id": prob_id, "fields": fields})
    if result.get("ok"):
        _bank_changed()
    return bool(result.get("ok"))


def bank_delete(prob_id):
    result = _post_action({"action": "bank_delete", "id": prob_id})
    if result.get("ok"):
        _bank_changed()
    return bool(result.get("ok"))


def taxonomy_upsert(grade, unit, type_, frame, description):
    result = _post_action({"action": "taxonomy_upsert", "grade": grade, "unit": unit, "type": type_,
                           "frame": frame, "description": description})
    _bank_changed()
    return bool(result.get("ok"))


def taxonomy_rename(level, old, new):
    payload = {"action": "taxonomy_rename", "level": level}
    for lv in TAX_LEVELS[:TAX_LEVELS.index(level) + 1]:
        payload["old_" + lv] = old.get(lv, "")
        payload["new_" + lv] = new.get(lv, "")
    result = _post_action(payload)
    _bank_changed()
    return result


def migrate_archive_to_bank():
    result = _post_action({"action": "migrate_archive"})
    _bank_changed()
    return result


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


def taxonomy_picker(key_prefix, taxonomy, suggestion=None, allow_new=True, levels=TAX_LEVELS):
    """학년 → 단원 → 유형 → 문제틀 순서로 고르는 선택 상자. 기존 이름에서 고르거나 '새로 입력'.
    suggestion(AI 제안)이 기존 이름이면 그걸 미리 고르고, 새 이름이면 '새로 입력' 칸에 채워 둔다.
    반환: {'grade','unit','type','frame','is_new_frame'}"""
    suggestion = suggestion or {}
    chosen = {}
    cols = st.columns(len(levels))
    for i, lv in enumerate(levels):
        with cols[i]:
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
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name)

    types = []
    for t in taxonomy:
        key = (t.get("grade", ""), t.get("unit", ""), t.get("type", ""))
        if key not in types:
            types.append(key)
    type_lines = "\n".join(f"{i}. {g} | {u} | {ty}" for i, (g, u, ty) in enumerate(types[:600]))
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
    - 출력은 JSON 한 줄만: {{"pick": 번호 또는 -1, "grade": "...", "unit": "...", "type": "..."}}
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
    frame_lines = "\n".join(f"{i}. {t.get('frame', '')} — {t.get('description', '')}" for i, t in enumerate(frames[:300]))
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
    return {"grade": grade, "unit": unit, "type": type_, "frame": frame,
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
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name)
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
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name)
    
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
@st.cache_data(show_spinner=False)
def get_fastest_model_name(api_key):
    try:
        genai.configure(api_key=api_key)
        available = [m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
        flash_models = [m for m in available if 'flash' in m and '2.5-flash' not in m]
        if flash_models:
            return flash_models[0]
        safe_models = [m for m in available if '2.5-flash' not in m]
        return safe_models[0] if safe_models else "gemini-1.5-pro"
    except Exception:
        return "gemini-1.5-flash"

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
LOGIN_TTL_ADMIN = 12 * 3600        # 선생님: 12시간
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
    st.session_state.auth_role = data.get("r") or None
    st.session_state.auth_student_id = data.get("u") or None


if not st.session_state.auth_role:
    restore_login_from_token()

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
                st.caption("탈퇴하면 계정과 내 보관함에 저장한 모든 문제가 삭제되며, 되돌릴 수 없습니다.")
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
        st.header("👥 학생 반 배정 관리")
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
                    st.rerun()
                else:
                    st.error("배정에 실패했습니다.")
        else:
            st.caption("아직 가입한 학생이 없습니다.")

        st.divider()
        st.header("🚫 학생 탈퇴 처리")
        # ★ 수정: 관리자가 특정 학생을 강제 탈퇴시키는 기능. 위에서 이미 불러온
        # student_list를 재사용해서 목록을 다시 조회하지 않음.
        if student_list:
            wd_sid_options = [s.get("student_id", "") for s in student_list]
            wd_pick_sid = st.selectbox("탈퇴시킬 학생 아이디", wd_sid_options, key="admin_withdraw_pick_sid")
            st.caption("⚠️ 탈퇴 처리하면 해당 학생의 계정과 개인 보관함 데이터가 모두 삭제되며, 되돌릴 수 없습니다.")
            wd_admin_confirm = st.checkbox(f"'{wd_pick_sid}' 학생을 정말 탈퇴시키겠습니까?", key="admin_withdraw_confirm")
            if st.button("탈퇴 처리하기", key="admin_withdraw_btn"):
                if not wd_admin_confirm:
                    st.warning("확인 체크박스를 선택해주세요.")
                else:
                    with st.spinner("탈퇴 처리 중..."):
                        ok = admin_withdraw_student(wd_pick_sid)
                    if ok:
                        st.success(f"'{wd_pick_sid}' 학생을 탈퇴 처리했습니다.")
                        st.rerun()
                    else:
                        st.error("탈퇴 처리에 실패했습니다.")
        else:
            st.caption("아직 가입한 학생이 없습니다.")

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
tab2 = tab3 = tab_archive = tab_stats = tab_mine = tab_bank = tab_similar = None
if current_role == "admin":
    tab1, tab2, tab_bank, tab_similar, tab_archive, tab_stats = st.tabs(
        ["📋 반 게시판", "📸 문제 만들기", "🏦 문제 은행", "🔍 비슷한 문제 찾기", "🗄️ 학생 보관함", "📊 학생별 유형 현황"])
else:
    tab1, tab_mine, tab3 = st.tabs(["📋 우리 반 게시판", "📚 선생님이 준 문제", "📂 예전 보관함"])

# ------------------------------------------
# [탭 1] 학생 게시판 (인쇄 메뉴 기본 숨김 접이식 적용)
# ------------------------------------------
def render_class_board(view_class, current_role, current_student_id):
    """게시판(tab1) 본문 렌더링 - 반이 배정된 사용자에 대해서만 호출됨."""
    # ★ 수정: 데이터가 계속 쌓여도 매번 받는 양이 일정하게 유지되도록,
    # 기본은 "최근 30일"치만 서버에서 걸러받는다. 반이 바뀌면 기간 설정도 초기화.
    if "board_range_days" not in st.session_state or st.session_state.get("board_range_class") != view_class:
        st.session_state.board_range_days = 30
        st.session_state.board_range_class = view_class

    st.subheader(f"📋 [{view_class}] 과제 게시판")

    show_all = st.session_state.board_range_days is None
    since_date = None
    if not show_all:
        since_date = (datetime.date.today() - datetime.timedelta(days=st.session_state.board_range_days)).strftime("%Y-%m-%d")

    with st.spinner("과제 목록을 불러오는 중..."):
        all_problems = fetch_problems(class_id=view_class, since_date=since_date)

    if not show_all:
        st.caption(f"📅 최근 {st.session_state.board_range_days}일치만 표시 중")
        if st.button("📜 이전 과제 더 보기 (전체 기간 보기)", key="load_more_btn"):
            st.session_state.board_range_days = None
            st.rerun()

    # 서버에서 이미 반 기준으로 걸러받았지만, 혹시 모를 값 불일치에 대비해 한 번 더 확인
    filtered = [p for p in all_problems if str(p.get("class_id", "")).strip() == view_class.strip()]

    if not filtered:
        st.info(f"아직 [{view_class}]에 등록된 과제가 없습니다.")
    else:
        filtered.reverse()
        
        grouped_by_date = {}
        for p in filtered:
            d_key, d_label = parse_date_group(p.get('date', ''))
            if d_key not in grouped_by_date:
                grouped_by_date[d_key] = {"label": d_label, "items": []}
            grouped_by_date[d_key]["items"].append(p)
            
        for d_key, group in grouped_by_date.items():
            with st.expander(f"📅 {group['label']} 과제 ({len(group['items'])}개 세트)", expanded=False):
                
                with st.expander("🖨️ 이 날짜 시험지 인쇄 및 HWP 복사 설정", expanded=False):
                    set_names = [f"과제 세트 {i}" for i in range(1, len(group["items"]) + 1)]
                    
                    selected_set_names = st.multiselect(
                        "출력할 과제 세트를 선택하세요:",
                        options=set_names,
                        default=set_names,
                        key=f"multisel_{d_key}"
                    )
                    
                    selected_indices = [int(s.replace("과제 세트 ", "")) - 1 for s in selected_set_names]
                    selected_items = [group["items"][i] for i in selected_indices if i < len(group["items"])]
                    
                    if selected_items:
                        print_html_content = make_printable_html(f"[{view_class}] {group['label']} 수학 학습지", selected_items)
                        
                        col_pr1, col_pr2 = st.columns([1, 1])
                        with col_pr1:
                            st.download_button(
                                label=f"📥 선택한 {len(selected_items)}개 세트 인쇄용 파일 열기",
                                data=print_html_content,
                                file_name=f"{view_class}_{group['label']}_수학_학습지.html",
                                mime="text/html",
                                key=f"dl_btn_{d_key}",
                                type="primary"
                            )
                            st.caption("💡 다운로드된 파일을 클릭하여 열면 바로 인쇄 창이 뜹니다.")
                            
                        with col_pr2:
                            with st.expander("📋 선택한 과제 한글(HWP) 복사용"):
                                # ★ 수정: format_math()는 HTML(<span>, <table> 등)을 만들기 때문에
                                # 복사용 텍스트에는 원문(LaTeX)을 그대로 넣는다.
                                hwp_bundle = f"[{view_class} - {group['label']} 수학 학습지]\n\n"
                                for s_idx, sp in enumerate(selected_items, start=1):
                                    q1_hwp = sp.get('q1','')
                                    q2_hwp = sp.get('q2','')
                                    hwp_bundle += f"■ 과제 세트 {s_idx}\n[문제 1]\n{q1_hwp}\n\n(풀이 공간)\n\n\n[문제 2]\n{q2_hwp}\n\n(풀이 공간)\n\n\n"
                                hwp_bundle += "--------------------------------------------------\n[정답 및 풀이]\n"
                                for s_idx, sp in enumerate(selected_items, start=1):
                                    a1_hwp = sp.get('a1','')
                                    s1_hwp = sp.get('s1','')
                                    a2_hwp = sp.get('a2','')
                                    s2_hwp = sp.get('s2','')
                                    hwp_bundle += f"■ 과제 세트 {s_idx}\n1번 정답: {a1_hwp}\n1번 풀이: {s1_hwp}\n2번 정답: {a2_hwp}\n2번 풀이: {s2_hwp}\n\n"
                                st.text_area("선택 묶음 복사 텍스트", hwp_bundle, height=130, key=f"bundle_hwp_{d_key}")
                    else:
                        st.warning("인쇄할 과제 세트를 1개 이상 선택해 주세요.")

                st.divider()

                for item_idx, p in enumerate(group["items"], start=1):
                    with st.container():
                        st.markdown(f"##### 📌 과제 세트 {item_idx}")
                        
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
                        
                        if current_role == "admin":
                            if st.button("🗑️ 이 과제 시트에서 삭제하기", key=f"del_{p.get('id')}"):
                                if delete_problem(p.get('id')):
                                    st.success("구글 시트에서 삭제되었습니다!")
                                    time.sleep(0.5)
                                    st.rerun()
                        elif current_student_id:
                            if st.button("💾 내 보관함에 저장", key=f"save_personal_{p.get('id')}"):
                                payload = build_personal_payload(
                                    student_id=current_student_id,
                                    class_id=view_class,
                                    source="board",
                                    origin_id=str(p.get("id", "")),
                                    q1=p.get("q1", ""), a1=p.get("a1", ""), s1=p.get("s1", ""),
                                    q2=p.get("q2", ""), a2=p.get("a2", ""), s2=p.get("s2", ""),
                                    image_b64=p.get("image_b64", ""),
                                )
                                with st.spinner("저장하는 중..."):
                                    if save_personal_problem(payload):
                                        st.success("✅ 내 보관함에 저장했어요!")
                                    else:
                                        st.error("❌ 저장에 실패했습니다.")
                    st.divider()


with tab1:
    col_view, col_ref = st.columns([3, 1])
    with col_view:
        if current_role == "admin":
            view_class = st.selectbox("👀 조회할 반 게시판을 선택하세요", class_list)
        else:
            view_class = current_role
    with col_ref:
        st.write("")
        if st.button("🔄 최신 과제 새로고침"):
            st.rerun()

    # ★ 수정: 아직 선생님이 반을 배정하지 않은 학생은 볼 게시판이 없으므로 안내만 표시
    if view_class == "미배정":
        st.info("🎓 아직 선생님이 반을 배정하지 않았어요. 배정되면 이곳에 게시판이 나타납니다.")
    else:
        render_class_board(view_class, current_role, current_student_id)


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
                    st.error(f"오류가 발생했습니다: {e}")

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
                        fast_model = get_fastest_model_name(gemini_api_key)
                    
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
                        st.error(f"오류가 발생했습니다: {e}")

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
                    col_post1, col_post2 = st.columns([1, 2])
                    with col_post1:
                        target_class = st.selectbox("📢 게시할 반 선택", class_list)
                    with col_post2:
                        st.write("")
                        st.write("")
                        if st.button(f"🚀 [{target_class}] 과제 바로 등록하기", type="primary"):
                            # ★ 수정: 시트 셀 용량 제한(50,000자)에 안전하게 걸리도록
                            # 저장용 사진만 별도로 압축 (OCR에는 영향 없음 - 이미 인식 끝난 뒤라서)
                            compressed_b64 = compress_image_for_storage(st.session_state.current_image_b64)
                            new_prob = {
                                "id": str(int(time.time() * 1000)),
                                "class_id": target_class, 
                                "date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                                "image_b64": compressed_b64,
                                "q1": p1["question"],
                                "a1": p1["answer"],
                                "s1": p1.get("solution", ""),
                                "q2": p2["question"],
                                "a2": p2["answer"],
                                "s2": p2.get("solution", ""),
                            }
                            with st.spinner("과제를 등록하는 중..."):
                                if save_problem(new_prob):
                                    st.success(f"✅ [{target_class}] 과제 등록 완료!")
                                    time.sleep(0.5)
                                else:
                                    # ★ 수정: 예전에는 실패해도 아무 표시가 없어서
                                    # "분명 등록했는데 게시판에 안 보인다"는 원인 파악이 어려웠음
                                    st.error("❌ 과제 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.")
                
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
                # ★ 문제 은행에 저장 (원본 + 1번 + 2번을 한 문제씩)
                # ==========================================
                st.subheader("🏦 문제 은행에 저장")
                if not bank_backend_ready():
                    st.warning(BANK_SETUP_MSG)
                else:
                    _bver = st.session_state.get("edit_ver", 0)
                    _bsug = st.session_state.get("suggested_frame") or {}
                    _tax = taxonomy_list()
                    st.caption("원본 문제와 만든 문제를 같은 문제틀로 묶어 저장합니다. 숫자나 난이도만 다른 문제는 같은 문제틀에 쌓아 주세요.")
                    if _bsug:
                        st.caption(f"🤖 AI 제안: {frame_path(_bsug)}" + (" (새 문제틀)" if _bsug.get("is_new_frame") else " (기존 문제틀)"))
                    _main = taxonomy_picker(f"bk_main_{_bver}", _tax, suggestion=_bsug)
                    _desc_default = _bsug.get("description", "") if _bsug.get("frame") == _main.get("frame") else ""
                    _frame_desc = ""
                    if _main.get("is_new_frame"):
                        _frame_desc = st.text_input("새 문제틀 설명 (어떤 조건에서 무엇을 구하는 문제인지)", value=_desc_default, key=f"bk_desc_{_bver}")

                    _rows = []
                    _orig_diff = _bsug.get("difficulty", "중") if _bsug.get("difficulty") in DIFFICULTIES else "중"
                    _candidates = [
                        ("원본", "📷 원본 문제 (학생이 틀린 문제)", st.session_state.ocr_text, "", "", _orig_diff),
                        ("AI 기본", "[문제 1] 기본 다지기", p1["question"], p1["answer"], p1.get("solution", ""), _orig_diff),
                        ("AI 실력", "[문제 2] 실력 키우기", p2["question"], p2["answer"], p2.get("solution", ""),
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

                    if st.button("🏦 문제 은행에 저장하기", type="primary", key=f"bk_save_{_bver}"):
                        _missing = [r for r in _rows if not all(r.get(lv) for lv in TAX_LEVELS)]
                        if not _rows:
                            st.warning("저장할 문제를 하나 이상 체크해 주세요.")
                        elif _missing:
                            st.warning("학년·단원·유형·문제틀을 모두 정해 주세요.")
                        else:
                            _img = ""
                            if any(r["use_image"] for r in _rows):
                                _img = compress_image_for_storage(st.session_state.current_image_b64, max_dimension=1400, max_chars=3_000_000)
                            with st.spinner("문제 은행에 저장하는 중..."):
                                _res = bank_save(_rows, _img)
                            if _res.get("ok"):
                                st.success(f"✅ {len(_rows)}문제를 저장했습니다 · {frame_path(_rows[0])}")
                            else:
                                st.error(f"❌ 저장에 실패했습니다: {_res.get('error', '알 수 없는 오류')}")
                st.divider()
                with st.expander("👤 학생에게 바로 주기 (학생 보관함)", expanded=False):
                    # ==========================================
                    # ★ 선생님 문제 보관함에 저장 (날짜 / 학생 / 유형)
                    # ==========================================
                    st.subheader("🗄️ 문제 보관함에 저장")
                    st.caption("위에서 확인·수정한 문제를 날짜, 대상 학생, 유형과 함께 오래 보관합니다. 원본 사진은 구글 드라이브에 따로 저장돼요.")

                    _ver = st.session_state.get("edit_ver", 0)
                    _sug = st.session_state.get("suggested_type") or {}
                    for _k in ("grade", "unit", "subtype"):
                        _key = f"arch_{_k}_{_ver}"
                        if _key not in st.session_state:
                            st.session_state[_key] = _sug.get(_k, "")

                    _types = archive_types()
                    _type_options = ["(AI 제안 / 직접 입력)"] + [type_label(t) for t in _types]

                    def _apply_existing_type():
                        choice = st.session_state.get(f"arch_pick_type_{_ver}")
                        for t in _types:
                            if type_label(t) == choice:
                                st.session_state[f"arch_grade_{_ver}"] = t.get("grade", "")
                                st.session_state[f"arch_unit_{_ver}"] = t.get("unit", "")
                                st.session_state[f"arch_subtype_{_ver}"] = t.get("subtype", "")
                                break

                    st.selectbox("기존 유형에서 고르기", _type_options, key=f"arch_pick_type_{_ver}", on_change=_apply_existing_type)
                    col_g, col_u, col_s = st.columns([1, 1.4, 2])
                    with col_g:
                        st.text_input("학년", key=f"arch_grade_{_ver}")
                    with col_u:
                        st.text_input("단원", key=f"arch_unit_{_ver}")
                    with col_s:
                        st.text_input("세부 유형", key=f"arch_subtype_{_ver}")
                    if _sug:
                        st.caption(f"🤖 AI 제안: {type_label(_sug)}")

                    _all_students = admin_list_students()
                    col_cls, col_date = st.columns([1, 1])
                    with col_cls:
                        _cls_filter = st.selectbox("학생 목록 반 필터", ["전체"] + class_list, key="arch_cls_filter")
                    with col_date:
                        _arch_date = st.date_input("날짜", value=datetime.date.today(), key="arch_date")
                    _student_options = [s.get("student_id", "") for s in _all_students
                                        if _cls_filter == "전체" or s.get("class_id", "") == _cls_filter]
                    _picked_students = st.multiselect("대상 학생 (여러 명 선택 가능, 비워두면 학생 미지정)", _student_options, key=f"arch_students_{_ver}")
                    _memo = st.text_input("메모 (선택)", key=f"arch_memo_{_ver}", placeholder="예: 3단계 이항에서 부호 실수")

                    _backend_ok = archive_backend_ready()
                    if not _backend_ok:
                        st.warning(ARCHIVE_SETUP_MSG)
                    if st.button("🗄️ 보관함에 저장하기", type="primary", key=f"arch_save_btn_{_ver}", disabled=not _backend_ok):
                        _grade = st.session_state.get(f"arch_grade_{_ver}", "").strip()
                        _unit = st.session_state.get(f"arch_unit_{_ver}", "").strip()
                        _subtype = st.session_state.get(f"arch_subtype_{_ver}", "").strip()
                        if not (_unit and _subtype):
                            st.warning("단원과 세부 유형을 입력해 주세요. 나중에 유형별로 찾을 때 필요해요.")
                        else:
                            _class_of = {s.get("student_id", ""): s.get("class_id", "") for s in _all_students}
                            _classes = {_class_of.get(sid, "") for sid in _picked_students}
                            if len(_classes) == 1:
                                _arch_class = _classes.pop()
                            elif not _picked_students and _cls_filter != "전체":
                                _arch_class = _cls_filter
                            else:
                                _arch_class = ""
                            _payload = {
                                "id": f"{int(time.time() * 1000)}",
                                "date": _arch_date.strftime("%Y-%m-%d") + datetime.datetime.now().strftime(" %H:%M"),
                                "student_ids": ",".join(_picked_students),
                                "class_id": _arch_class,
                                "grade": _grade, "unit": _unit, "subtype": _subtype,
                                "source_text": st.session_state.ocr_text,
                                "image_b64": compress_image_for_storage(st.session_state.current_image_b64, max_dimension=1400, max_chars=3_000_000),
                                "q1": p1["question"], "a1": p1["answer"], "s1": p1.get("solution", ""),
                                "q2": p2["question"], "a2": p2["answer"], "s2": p2.get("solution", ""),
                                "memo": _memo,
                            }
                            with st.spinner("보관함에 저장하는 중..."):
                                _result = archive_save(_payload)
                            if _result.get("ok"):
                                archive_types.clear()
                                _who = ", ".join(_picked_students) if _picked_students else "학생 미지정"
                                st.success(f"✅ 보관 완료! ({_payload['date'][:10]} · {_who} · {_grade} › {_unit} › {_subtype})")
                            else:
                                st.error(f"❌ 보관에 실패했습니다: {_result.get('error', '알 수 없는 오류')}")


# ------------------------------------------
# [탭 3] 내 보관함 (학생으로 로그인한 경우에만 존재)
# ------------------------------------------
if tab3:
    with tab3:
        st.subheader("📂 예전 보관함")
        st.caption("스스로 만들어서 저장한 문제와, 게시판에서 저장해온 문제를 여기서 다시 볼 수 있어요.")

        sub_self, sub_board = st.tabs(["🖊️ 내가 만든 문제", "🔖 게시판에서 저장한 문제"])

        with sub_self:
            with st.spinner("불러오는 중..."):
                my_self_items = fetch_personal_problems(current_student_id, source="self")
            if not my_self_items:
                st.info("아직 스스로 만들어서 저장한 문제가 없어요. 이제는 선생님이 '선생님이 준 문제' 탭에 문제를 저장해 줘요.")
            else:
                my_self_items = sorted(my_self_items, key=lambda x: x.get("date", ""), reverse=True)
                for p in my_self_items:
                    render_personal_item(p, current_student_id)

        with sub_board:
            with st.spinner("불러오는 중..."):
                my_board_items = fetch_personal_problems(current_student_id, source="board")
            if not my_board_items:
                st.info("아직 게시판에서 저장한 문제가 없어요. '우리 반 게시판' 탭에서 문제 옆의 저장 버튼을 눌러보세요!")
            else:
                my_board_items = sorted(my_board_items, key=lambda x: x.get("date", ""), reverse=True)
                for p in my_board_items:
                    render_personal_item(p, current_student_id)


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
                _head = f"📅 {p.get('date', '')} · 👤 {p.get('student_ids') or '학생 미지정'} · 🏷️ {type_label(p)}"
                with st.expander(_head):
                    if p.get("memo"):
                        st.info(f"📝 {p['memo']}")
                    render_archive_problem_body(p, "ab")
                    st.markdown("---")
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
        st.subheader("📊 학생별 유형 현황")
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
if tab_mine is not None:
    with tab_mine:
        st.subheader("📚 선생님이 준 문제")
        if not archive_backend_ready():
            st.info("선생님이 아직 문제를 저장해 주지 않았어요.")
        else:
            if "mine_limit" not in st.session_state:
                st.session_state.mine_limit = 30
            with st.spinner("불러오는 중..."):
                _mres = archive_search(student=current_student_id, limit=st.session_state.mine_limit)
            _mitems = _mres["items"]
            if not _mitems:
                st.info("아직 선생님이 저장해 준 문제가 없어요.")
            else:
                _my_types = sorted({type_label(p) for p in _mitems})
                _pick = st.selectbox("유형으로 보기", ["전체"] + _my_types, key="mine_type")
                _shown = [p for p in _mitems if _pick == "전체" or type_label(p) == _pick]
                _by_date = {}
                for p in _shown:
                    _by_date.setdefault(p.get("date", "")[:10], []).append(p)
                for _d, _plist in _by_date.items():
                    st.markdown(f"#### 📅 {_d}")
                    for p in _plist:
                        with st.expander(f"🏷️ {type_label(p)}"):
                            render_archive_problem_body(p, "mine")
                if len(_mitems) < _mres["total"]:
                    if st.button("⬇️ 이전 문제 더 보기", key="mine_more"):
                        st.session_state.mine_limit += 30
                        st.rerun()


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
            sub_find, sub_tax, sub_move = st.tabs(["🔎 문제 찾기", "🗂️ 유형표", "📦 예전 보관함 옮기기"])

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

            with sub_move:
                st.caption("'학생 보관함'에 저장했던 문제를 문제 은행으로 복사합니다. 한 번 옮긴 문제는 다시 옮겨지지 않고, 학생 보관함 자료는 그대로 남아요.")
                st.caption("예전 분류(학년 › 단원 › 세부 유형)는 유형과 문제틀에 같은 이름으로 들어갑니다. 옮긴 뒤 '유형표'에서 다듬어 주세요.")
                if st.button("📦 예전 보관함 문제 옮기기", key="mv_run"):
                    with st.spinner("옮기는 중..."):
                        _m = migrate_archive_to_bank()
                    if _m.get("ok"):
                        st.success(f"{_m.get('sets', 0)}세트, {_m.get('problems', 0)}문제를 옮겼습니다.")
                    else:
                        st.error(f"실패했습니다: {_m.get('error', '')}")


# ------------------------------------------
# [선생님] 비슷한 문제 찾기: 새 문제 → AI가 문제틀을 찾고 → 문제 은행에서 골라 내기
# ------------------------------------------
if tab_similar is not None:
    with tab_similar:
        st.subheader("🔍 비슷한 문제 찾기")
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
                        st.error(f"읽기에 실패했습니다: {e}")
            _stext = st.text_area("문제 내용 (직접 입력하거나 고칠 수 있어요)", value=st.session_state.get("sim_text", ""), key=f"sim_text_area_{st.session_state.get('sim_ocr_n', 0)}", height=120)
            if _stext.strip() and st.button("🤖 AI로 문제틀 찾기", type="primary", key="sim_classify"):
                if not _stax:
                    st.warning("문제 은행이 아직 비어 있어요. 먼저 문제를 저장해 주세요.")
                else:
                    with st.spinner("AI가 같은 문제틀을 찾는 중..."):
                        try:
                            st.session_state.sim_result = classify_frame(_stext, _stax, gemini_api_key, get_fastest_model_name(gemini_api_key))
                            st.session_state.sim_ver = st.session_state.get("sim_ver", 0) + 1
                        except Exception as e:
                            st.error(f"AI 분류에 실패했습니다: {e}")

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
                        st.markdown("##### 미리 보기")
                        for i, p in enumerate(_chosen, start=1):
                            with st.container(border=True):
                                st.markdown(f"**[{i}]** · 난이도 {p.get('difficulty', '')}")
                                render_bank_problem(p, "sim", editable=False)
