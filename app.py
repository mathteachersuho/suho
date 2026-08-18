import streamlit as st
import requests
import json
import base64
import re
import os
import time
import datetime
import io
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
        fetch_url = f"{sheet_url}?t={int(time.time() * 1000)}"
        if sheet_api_token:
            fetch_url += f"&token={sheet_api_token}"
        if class_id:
            fetch_url += f"&class_id={class_id}"
        if since_date:
            fetch_url += f"&since={since_date}"
        res = requests.get(fetch_url, timeout=30)
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

STATUS_FILE = "app_status.txt"
def get_app_status():
    if os.path.exists(STATUS_FILE):
        with open(STATUS_FILE, "r") as f:
            return f.read().strip()
    return "OFF"

def set_app_status(status):
    with open(STATUS_FILE, "w") as f:
        f.write(status)

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
admin_pw = st.secrets.get("ADMIN_PASSWORD", "1234")
class_list = ["1M2", "1M3", "2M1", "2M3", "3M1", "3M3"]
class_pws = {
    "1M2": st.secrets.get("PW_CLASS1", "0102"),
    "1M3": st.secrets.get("PW_CLASS2", "0103"),
    "2M1": st.secrets.get("PW_CLASS3", "0201"),
    "2M3": st.secrets.get("PW_CLASS4", "0203"),
    "3M1": st.secrets.get("PW_CLASS5", "0301"),
    "3M3": st.secrets.get("PW_CLASS6", "0303"),
}

mathpix_app_id = st.secrets.get("MATHPIX_APP_ID", "")
mathpix_app_key = st.secrets.get("MATHPIX_APP_KEY", "")
gemini_api_key = st.secrets.get("GEMINI_API_KEY", "")

with st.sidebar:
    st.header("🔑 클래스룸 입장하기")
    entered_pw = st.text_input("선생님이 안내해주신 접속 코드를 입력하세요", type="password")
    
    current_role = None
    if entered_pw:
        if entered_pw == admin_pw:
            current_role = "admin"
            st.success("👨‍🏫 선생님 인증 완료!")
        else:
            for cls_name, cls_pw in class_pws.items():
                if entered_pw == cls_pw:
                    current_role = cls_name
                    st.success(f"🎓 {cls_name} 학생 인증 완료!")
                    break
            if not current_role:
                st.error("접속 코드가 틀렸습니다.")

    if current_role == "admin":
        st.divider()
        st.header("⚙️ 앱 전체 관리 (스위치)")
        current_status = get_app_status()
        new_status = st.radio("학생 접속 허용", ["ON (수업 중)", "OFF (잠금)"], index=0 if current_status == "ON" else 1)
        if "ON" in new_status and current_status == "OFF":
            set_app_status("ON"); st.rerun()
        elif "OFF" in new_status and current_status == "ON":
            set_app_status("OFF"); st.rerun()

# ==========================================
# 화면 차단 로직
# ==========================================
if not current_role:
    st.info("👈 왼쪽 메뉴에 접속 코드를 입력해야 클래스룸에 입장할 수 있습니다.")
    st.stop()

if current_role != "admin" and get_app_status() == "OFF":
    st.error("⛔ 현재는 수학 앱 사용 시간이 아닙니다. 선생님이 수업을 열어주시면 새로고침(F5) 하세요.")
    st.stop()

if not (mathpix_app_id and mathpix_app_key and gemini_api_key):
    st.error("⚠️ 선생님의 API 키가 Secrets에 설정되지 않아 앱을 실행할 수 없습니다.")
    st.stop()

st.caption(f"현재 접속 권한: **{'선생님 (모든 반 관리)' if current_role == 'admin' else current_role}**")

if current_role == "admin" and sheet_url and not sheet_api_token:
    st.warning(
        "⚠️ 보안 경고: SHEET_API_TOKEN이 설정되어 있지 않습니다. "
        "지금은 구글 시트 주소만 알면 앱을 거치지 않고도 누구나 과제를 추가/삭제할 수 있는 상태입니다. "
        "Secrets에 SHEET_API_TOKEN을 추가하고, Apps Script 쪽 스크립트 속성에도 같은 값을 넣어주세요."
    )

# ==========================================
# 메인 화면: 두 개의 탭
# ==========================================
tab1, tab2 = st.tabs(["📋 우리 반 게시판", "📸 스스로 문제 만들기"])

# ------------------------------------------
# [탭 1] 학생 게시판 (인쇄 메뉴 기본 숨김 접이식 적용)
# ------------------------------------------
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
                                hwp_bundle = f"[{view_class} - {group['label']} 수학 학습지]\n\n"
                                for s_idx, sp in enumerate(selected_items, start=1):
                                    q1_hwp = format_math(sp.get('q1',''))
                                    q2_hwp = format_math(sp.get('q2',''))
                                    hwp_bundle += f"■ 과제 세트 {s_idx}\n[문제 1]\n{q1_hwp}\n\n(풀이 공간)\n\n\n[문제 2]\n{q2_hwp}\n\n(풀이 공간)\n\n\n"
                                hwp_bundle += "--------------------------------------------------\n[정답 및 풀이]\n"
                                for s_idx, sp in enumerate(selected_items, start=1):
                                    a1_hwp = format_math(sp.get('a1',''))
                                    s1_hwp = format_math(sp.get('s1',''))
                                    a2_hwp = format_math(sp.get('a2',''))
                                    s2_hwp = format_math(sp.get('s2',''))
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
                    st.divider()

# ------------------------------------------
# [탭 2] 개인용 문제 생성기 & 화면 직관적 수정 에디터
# ------------------------------------------
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
                
                res = requests.post("https://api.mathpix.com/v3/text", headers=headers, json=data)
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
                    
                    with ThreadPoolExecutor(max_workers=2) as executor:
                        future_p1 = executor.submit(generate_one_problem_async, "1번 기본 다지기 문제", 1, edited_text, solution_instruction, gemini_api_key, fast_model)
                        future_p2 = executor.submit(generate_one_problem_async, "2번 실력 키우기 문제", 2, edited_text, solution_instruction, gemini_api_key, fast_model)
                        
                        p1_res = future_p1.result()
                        p2_res = future_p2.result()
                    
                    st.session_state.similar_problems = [p1_res, p2_res]
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
                            "id": str(int(time.time())),
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
                        p1_q_new = st.text_area("1번 지문 내용:", value=p1.get("question", ""), key="inline_p1_q", height=120)
                        col_a1, col_s1 = st.columns([1, 2])
                        with col_a1:
                            p1_a_new = st.text_input("1번 정답:", value=p1.get("answer", ""), key="inline_p1_a")
                        with col_s1:
                            p1_s_new = st.text_input("1번 풀이:", value=p1.get("solution", ""), key="inline_p1_s")
                        
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
                        p2_q_new = st.text_area("2번 지문 내용:", value=p2.get("question", ""), key="inline_p2_q", height=120)
                        col_a2, col_s2 = st.columns([1, 2])
                        with col_a2:
                            p2_a_new = st.text_input("2번 정답:", value=p2.get("answer", ""), key="inline_p2_a")
                        with col_s2:
                            p2_s_new = st.text_input("2번 풀이:", value=p2.get("solution", ""), key="inline_p2_s")
                        
                        p2["question"] = p2_q_new
                        p2["answer"] = p2_a_new
                        p2["solution"] = p2_s_new
            st.write("")
