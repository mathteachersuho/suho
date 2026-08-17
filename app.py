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
# ★ 수식 렌더링 & 빈칸 상자(\boxed) 전용 엔진
# ==========================================
def format_math(text):
    if not text:
        return ""
    text = str(text)
    
    # 1. 줄바꿈 기호 변환
    text = text.replace('[br]', '\n\n')
    
    # 2. Mathpix의 $$...$$ 블록 수식을 표준 $...$로 정규화
    text = re.sub(r'\$\$(.*?)\$\$', r'$\1$', text, flags=re.DOTALL)
    
    # 3. 빈칸 문자 및 기호 박스화 자동 변환 (가~라, square 등)
    # OCR로 들어온 빈 네모상자나 (가) 기호를 $\boxed{\text{ (가) }}$ 형태로 변환
    text = re.sub(r'[□■]\s*\(([가-힣a-zA-Z0-9]+)\)', r'$\\boxed{\\text{ (\1) }}$', text)
    text = re.sub(r'\[\s*\(([가-힣a-zA-Z0-9]+)\)\s*\]', r'$\\boxed{\\text{ (\1) }}$', text)
    
    # 4. 명령어 앞 중복 백슬래시 정리
    text = re.sub(r'\\\\([a-zA-Z{}])', r'\\\1', text)
    text = re.sub(r'\\\\([a-zA-Z{}])', r'\\\1', text)
    
    # 5. 도형 및 기하 수식 기호 정규화 (\triangle, \overline, \angle, \equiv, \parallel)
    text = re.sub(r'\\mathrm\{([A-Z]+)\}', r'\1', text)  # \mathrm{ABC} -> ABC
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
    
    # 6. $ 기호 없이 노출된 수식 및 함수 자동 감싸기
    parts = text.split('$')
    new_parts = []
    for i, part in enumerate(parts):
        if i % 2 == 0:  # $ 기호 바깥 영역
            def replacer(match):
                chunk = match.group(1).rstrip()
                if not chunk:
                    return ""
                return f"${chunk}$"
            pattern = r'(\\[a-zA-Z]+(?:\{[^{}]*\}|[\w\s+\-*/=<>(),._\^\\{}]*?))(?=[가-힣\n\r]|$)'
            part = re.sub(pattern, replacer, part)
            part = re.sub(r'(?<![$\\])\b([fgh]\'?\([a-zA-Z\d+\-*/]*\))(?![$\\])', r'$\1$', part)
        new_parts.append(part)
    
    result = '$'.join(new_parts)
    result = re.sub(r'\$\s*\$', '', result)
    result = re.sub(r'\${3,}', '$$', result)
    return result

def parse_date_group(date_str):
    """모든 날짜 형식을 'M월 D일'로 변환"""
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

def parse_tag_problems(res_text):
    p1_q = re.search(r'\[(?:문제\s*1|1번\s*문제)\]([\s\S]*?)(?=\[(?:정답\s*1|1번\s*정답)\]|$)', res_text)
    p1_a = re.search(r'\[(?:정답\s*1|1번\s*정답)\]([\s\S]*?)(?=\[(?:풀이\s*1|1번\s*풀이)\]|$)', res_text)
    p1_s = re.search(r'\[(?:풀이\s*1|1번\s*풀이)\]([\s\S]*?)(?=\[(?:문제\s*2|2번\s*문제)\]|$)', res_text)
    
    p2_q = re.search(r'\[(?:문제\s*2|2번\s*문제)\]([\s\S]*?)(?=\[(?:정답\s*2|2번\s*정답)\]|$)', res_text)
    p2_a = re.search(r'\[(?:정답\s*2|2번\s*정답)\]([\s\S]*?)(?=\[(?:풀이\s*2|2번\s*풀이)\]|$)', res_text)
    p2_s = re.search(r'\[(?:풀이\s*2|2번\s*풀이)\]([\s\S]*?)$', res_text)
    
    if p1_q and p2_q:
        return [
            {
                "problem_num": 1,
                "question": p1_q.group(1).strip(),
                "answer": p1_a.group(1).strip() if p1_a else "",
                "solution": p1_s.group(1).strip() if p1_s else ""
            },
            {
                "problem_num": 2,
                "question": p2_q.group(1).strip(),
                "answer": p2_a.group(1).strip() if p2_a else "",
                "solution": p2_s.group(1).strip() if p2_s else ""
            }
        ]
    return None

# ==========================================
# ★ A4 규격 인쇄용 HTML 생성기 (빈칸 박스 & 증명 상자 스타일 지원)
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
                inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
                displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
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
        
    st.subheader(f"📋 [{view_class}] 과제 게시판")
    
    with st.spinner("과제 목록을 불러오는 중..."):
        all_problems = fetch_problems()
    
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
                        st.markdown(q1_safe)
                        with st.expander("🔍 1번 정답 및 풀이 확인"):
                            st.markdown(f"**정답:** {a1_safe}")
                            if s1_safe:
                                st.markdown(f"**풀이:**\n\n{s1_safe}")
                        
                        st.markdown("#### [문제 2] 실력 키우기")
                        st.markdown(q2_safe)
                        with st.expander("🔍 2번 정답 및 풀이 확인"):
                            st.markdown(f"**정답:** {a2_safe}")
                            if s2_safe:
                                st.markdown(f"**풀이:**\n\n{s2_safe}")
                        
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
                    st.success("수식 추출 성공! 내용을 확인하고 필요시 수정해 주세요.")
                else:
                    st.error("인식에 실패했습니다. 다시 시도해 주세요.")
            except Exception as e:
                st.error(f"오류가 발생했습니다: {e}")

    if st.session_state.ocr_text:
        if st.session_state.current_image_b64:
            st.image(f"data:image/jpeg;base64,{st.session_state.current_image_b64}", caption="[원본 도형 이미지]", use_container_width=True)

        edited_text = st.text_area("도형 조건이나 수식 중 누락된 부분을 수정하세요:", value=st.session_state.ocr_text, height=150)
        st.session_state.ocr_text = edited_text
        st.markdown("**수식 렌더링 미리보기:**")
        st.markdown(format_math(edited_text))
        
        include_detailed = st.checkbox("📖 상세 단계별 해설 포함하기 (체크 해제 시 핵심 풀이만 생성)", value=False)
        
        if st.button("✨ 유사 문제 2개 초고속 생성 (기본1 + 응용1)", type="primary"):
            with st.spinner("Gemini가 단원 범위에 맞춰 문제를 출제하고 있습니다..."):
                try:
                    fast_model_name = get_fastest_model_name(gemini_api_key)
                    model = genai.GenerativeModel(fast_model_name)
                    
                    solution_instruction = "학생들이 이해하기 쉽게 단계별 상세 풀이와 해설 작성" if include_detailed else "핵심 수식 전개 및 정답 도출 과정만 1~2줄로 매우 간결하게 작성"
                    
                    # ★ 빈칸 채우기 및 기하 증명 박스 출제 규칙 강화
                    prompt = f"""
                    너는 대한민국 고등학교 수학 교육과정에 엄격히 맞추는 출제 위원이야.
                    아래 [원본 문제]의 **'단원 범위와 출제 개념'**을 절대 벗어나지 말고 [유사 문제 1]과 [유사 문제 2]를 제작해줘.

                    [원본 문제]
                    {edited_text}

                    [출제 원칙 및 교육과정 준수]
                    1. **단원 범위 준수 (선행 개념 절대 금지):**
                       - 원본 문제가 미분/도함수 단원이면, 아직 배우지 않은 '적분 기호($\\int$)'나 적분 개념을 절대로 사용하지 마라.
                       - 원본 문제가 극한 단원이면 미분/적분을 쓰지 마라.
                       - 2번(실력 키우기) 문제 역시 다른 후속 단원과 섞지 말고, **현재 원본 문제 단원 내에서만** 조건을 심화하여 출제하라.
                    2. **빈칸 채우기 및 증명 문제 작성 규칙:**
                       - 빈칸은 반드시 `$\\boxed{{\\text{{ (가) }}}}$`, `$\\boxed{{\\text{{ (나) }}}}$`, `$\\boxed{{\\text{{ (다) }}}}$` 형태로 작성할 것.
                       - 증명 과정의 단계별 줄바꿈과 기하 기호($\\triangle, \\angle, \\overline{{AB}}, \\equiv, \\parallel, \\therefore$)를 명확하게 살려서 작성할 것.
                    3. **도형 및 그래프 문제 서술 규칙:**
                       - 원본 문제에 도형/그래프가 있는 경우, 필수 성질이나 개형을 문제 본문에 텍스트/수식 조건으로 명확히 서술하여 새 그림 없이도 완벽히 풀 수 있게 하라.
                    4. **문제 구성:**
                       - 1번 문제: 조건과 숫자만 바꾼 기본 다지기 문제
                       - 2번 문제: 같은 단원 개념 내에서 묻는 방식을 변형한 실력 키우기 문제

                    [수식 작성 규칙]
                    1. 모든 수식, 분수식, 극한식, 기하 기호, 빈칸 박스는 반드시 `$수식$` 기호로 감싸라.
                    2. $ 기호 안에는 순수 수식만 넣고 한글은 $ 밖에 둘 것.
                    3. 아래 출력 양식을 정확히 지켜서 출력할 것.

                    [출력 양식]
                    [문제 1]
                    (1번 문제 본문)
                    [정답 1]
                    (1번 정답)
                    [풀이 1]
                    ({solution_instruction})

                    [문제 2]
                    (2번 문제 본문)
                    [정답 2]
                    (2번 정답)
                    [풀이 2]
                    ({solution_instruction})
                    """
                    
                    response = model.generate_content(prompt)
                    res_text = response.text.strip()
                    
                    problems = parse_tag_problems(res_text)
                    
                    if problems:
                        st.session_state.similar_problems = problems
                        st.success(f"⚡ 생성 완료! (사용된 모델: {fast_model_name})")
                    else:
                        st.error("문제 생성 양식 분석에 실패했습니다. 다시 생성 버튼을 눌러주세요.")
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
            
            if current_role == "admin":
                col_post1, col_post2 = st.columns([1, 2])
                with col_post1:
                    target_class = st.selectbox("📢 게시할 반 선택", class_list)
                with col_post2:
                    st.write("")
                    st.write("")
                    if st.button(f"🚀 [{target_class}] 과제 바로 등록하기", type="primary"):
                        new_prob = {
                            "id": str(int(time.time())),
                            "class_id": target_class, 
                            "date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                            "image_b64": st.session_state.current_image_b64 or "",
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
                st.markdown(format_math(p1.get("question", "")))
                
                with st.expander("🔍 1번 정답 및 풀이 확인"):
                    st.markdown(f"**정답:** {format_math(p1.get('answer', ''))}")
                    if p1.get("solution"):
                        st.markdown(f"**풀이:**\n\n{format_math(p1.get('solution', ''))}")
                
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
                st.markdown(format_math(p2.get("question", "")))
                
                with st.expander("🔍 2번 정답 및 풀이 확인"):
                    st.markdown(f"**정답:** {format_math(p2.get('answer', ''))}")
                    if p2.get("solution"):
                        st.markdown(f"**풀이:**\n\n{format_math(p2.get('solution', ''))}")
                
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
