import streamlit as st
import requests
import json
import base64
import re
import os
import time
import datetime
import google.generativeai as genai

# 페이지 기본 설정
st.set_page_config(page_title="수학 유사 문제 클래스룸", layout="centered")

st.title("📐 AI 수학 온라인 클래스룸")

# ==========================================
# ★ 구글 스프레드시트 연동 DB 함수
# ==========================================
sheet_url = st.secrets.get("GOOGLE_SHEET_URL", "").strip()

def fetch_problems():
    """구글 시트에서 전체 과제 불러오기 (캐시 방지 적용)"""
    if not sheet_url:
        if os.path.exists("shared_problems.json"):
            with open("shared_problems.json", "r", encoding="utf-8") as f:
                return json.load(f)
        return []
    
    try:
        fetch_url = f"{sheet_url}?t={int(time.time() * 1000)}"
        res = requests.get(fetch_url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list):
                return data
            elif isinstance(data, str):
                return json.loads(data)
    except Exception as e:
        st.error(f"데이터베이스 연결 오류: {e}")
    return []

def save_problem(problem_data):
    """구글 시트에 새 과제 추가하기"""
    if not sheet_url:
        curr = fetch_problems()
        curr.insert(0, problem_data)
        with open("shared_problems.json", "w", encoding="utf-8") as f:
            json.dump(curr, f, ensure_ascii=False, indent=2)
        return True
    
    try:
        res = requests.post(sheet_url, json=problem_data, timeout=10)
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
        res = requests.post(sheet_url, json={"action": "delete", "id": str(prob_id)}, timeout=10)
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
# ★ 수식 렌더링, 표, 그래프/도형 SVG 통합 엔진
# ==========================================
def _clean_cell(col):
    col = col.strip()
    col = re.sub(r'\$([0-9a-zA-Z가-힣\s,.~%+-]+)\$', r'\1', col)
    if col.startswith('$') and col.endswith('$') and '\\' not in col:
        col = col[1:-1].strip()
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
    
    text = text.replace('[br]', '\n\n')
    text = re.sub(r'\$\$(.*?)\$\$', r'$\1$', text, flags=re.DOTALL)
    text = re.sub(r'[□■]\s*\(([가-힣a-zA-Z0-9]+)\)', r'$\\boxed{\\text{ (\1) }}$', text)
    text = re.sub(r'\[\s*\(([가-힣a-zA-Z0-9]+)\)\s*\]', r'$\\boxed{\\text{ (\1) }}$', text)
    text = re.sub(r'\\\\([a-zA-Z{}])', r'\\\1', text)
    text = re.sub(r'\\\\([a-zA-Z{}])', r'\\\1', text)
    
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
    
    def render_cards(match):
        items = [x.strip() for x in match.group(1).split(',') if x.strip()]
        card_html = '<div style="display:inline-flex; gap:8px; margin:8px 0; align-items:center; vertical-align:middle;">'
        for item in items:
            card_html += f'<div style="min-width:32px; height:46px; padding:2px 8px; border:2px solid #333; border-radius:6px; background-color:#ffffff; color:#111111; font-weight:bold; font-size:16px; display:inline-flex; align-items:center; justify-content:center; box-shadow:1px 2px 4px rgba(0,0,0,0.12);">{item}</div>'
        card_html += '</div>'
        return card_html
    text = re.sub(r'\[카드\s*:\s*([^\]]+)\]', render_cards, text)
    
    def wrap_svg_card(match):
        svg_content = match.group(0)
        return f'<div style="text-align: center; margin: 12px 0;"><div style="display: inline-block; background-color: #ffffff; padding: 12px 18px; border-radius: 8px; border: 1px solid #d0d0d0; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">{svg_content}</div></div>'
    text = re.sub(r'(<svg[\s\S]*?<\/svg>)', wrap_svg_card, text)
    
    return text

def parse_date_group(date_str):
    if not date_str: return "9999-99-99", "날짜 미상"
    return date_str, date_str

def parse_tag_problems(res_text):
    p1_q = re.search(r'\[(?:문제\s*1|1번\s*문제)\]([\s\S]*?)(?=\[(?:정답\s*1|1번\s*정답)\]|$)', res_text)
    p1_a = re.search(r'\[(?:정답\s*1|1번\s*정답)\]([\s\S]*?)(?=\[(?:풀이\s*1|1번\s*풀이)\]|$)', res_text)
    p1_s = re.search(r'\[(?:풀이\s*1|1번\s*풀이)\]([\s\S]*?)(?=\[(?:문제\s*2|2번\s*문제)\]|$)', res_text)
    p2_q = re.search(r'\[(?:문제\s*2|2번\s*문제)\]([\s\S]*?)(?=\[(?:정답\s*2|2번\s*정답)\]|$)', res_text)
    p2_a = re.search(r'\[(?:정답\s*2|2번\s*정답)\]([\s\S]*?)(?=\[(?:풀이\s*2|2번\s*풀이)\]|$)', res_text)
    p2_s = re.search(r'\[(?:풀이\s*2|2번\s*풀이)\]([\s\S]*?)$', res_text)
    if p1_q and p2_q:
        return [{"problem_num": 1, "question": p1_q.group(1).strip(), "answer": p1_a.group(1).strip() if p1_a else "", "solution": p1_s.group(1).strip() if p1_s else ""},
                {"problem_num": 2, "question": p2_q.group(1).strip(), "answer": p2_a.group(1).strip() if p2_a else "", "solution": p2_s.group(1).strip() if p2_s else ""}]
    return None

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
        html_pages += f"""
        <div class="a4-page">
            <div class="header-box">
                <div class="header-title">📐 {title} (세트 {idx})</div>
                <div class="name-box">이름: ______________</div>
            </div>
            <div class="problem-container">
                <div class="prob-header">[문제 1]</div>
                <div class="prob-body">{q1}</div>
                <div class="work-space"></div>
            </div>
            <div class="problem-container">
                <div class="prob-header">[문제 2]</div>
                <div class="prob-body">{q2}</div>
                <div class="work-space"></div>
            </div>
        </div>
        """
        ans_items += f'<div style="margin-bottom:10px;"><strong>세트 {idx}</strong><br>1번 정답: {a1} / 2번 정답: {a2}</div>'
    return f"""<html><head><style>
        @page {{ size: A4; margin: 10mm; }}
        .a4-page {{ height: 270mm; page-break-after: always; display: flex; flex-direction: column; }}
        .header-box {{ border-bottom: 2px solid #000; padding-bottom: 5px; }}
        .problem-container {{ flex: 1; border-bottom: 1px dashed #ccc; padding: 10px 0; }}
        .work-space {{ height: 80px; border: 1px dotted #999; margin-top: 10px; }}
        @media print {{ .print-btn {{ display: none; }} }}
    </style></head><body>
    <button class="print-btn" onclick="window.print()">🖨️ 인쇄</button>
    {html_pages}
    <h3>[정답]</h3>{ans_items}
    </body></html>"""

# ==========================================
# ★ 메인 로직
# ==========================================
with st.sidebar:
    st.header("🔑 클래스룸 입장하기")
    entered_pw = st.text_input("접속 코드 입력", type="password")
    
    current_role = None
    if entered_pw:
        if entered_pw == admin_pw: current_role = "admin"
        else:
            for cls_name, cls_pw in class_pws.items():
                if entered_pw == cls_pw: current_role = cls_name

# 메인 화면
if current_role:
    tab1, tab2 = st.tabs(["📋 게시판", "📸 문제 생성"])
    
    with tab2:
        st.subheader("📸 문제 생성기")
        uploaded_file = st.file_uploader("문제 사진 업로드", type=["png", "jpg", "jpeg"])
        
        # ★ 생성 품질 선택 스위치
        graph_quality = st.radio("그래프 생성 품질", ["⚡ 고속 (표/텍스트 위주)", "🎨 고화질 (SVG 그래프 포함)"], index=1)
        
        if uploaded_file and st.button("추출"):
            st.session_state.current_image_b64 = base64.b64encode(uploaded_file.getvalue()).decode('utf-8')
            # ... (OCR 로직 동일) ...
            st.success("추출 완료!")

        if st.session_state.get("ocr_text"):
            if st.button("✨ 유사 문제 생성"):
                fast_model = get_fastest_model_name(gemini_api_key)
                model = genai.GenerativeModel(fast_model)
                
                # 프롬프트에 graph_quality 스위치 연동
                graph_prompt = "SVG 그래프를 완벽하게 그릴 것" if "고화질" in graph_quality else "복잡한 그래프는 표(Markdown Table)로 대신할 것"
                
                prompt = f"""
                너는 수학 출제 위원이야. 원본 문제의 그래프 유형에 따라 다음을 준수해:
                {graph_prompt}
                - 그래프인 경우 격자선(가로/세로)을 완벽하게 그릴 것.
                - 모든 글자는 검정색(`fill="#000000"`)으로 할 것.
                ... (기존 출제 지침 생략) ...
                """
                # ... (문제 생성 로직 생략) ...
                st.success("생성 완료!")
