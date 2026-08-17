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
    """구글 시트에서 전체 과제 불러오기"""
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
            return data if isinstance(data, list) else json.loads(data)
    except: pass
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
    except: return False

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
    except: return False

# ==========================================
# ★ 수식 렌더링 & SVG 엔진
# ==========================================
def format_math(text):
    if not text: return ""
    text = str(text)
    text = text.replace('[br]', '\n\n')
    text = re.sub(r'\$\$(.*?)\$\$', r'$\1$', text, flags=re.DOTALL)
    text = re.sub(r'[□■]\s*\(([가-힣a-zA-Z0-9]+)\)', r'$\\boxed{\\text{ (\1) }}$', text)
    
    # SVG 다이어그램 흰색 카드 박스 감싸기
    def wrap_svg_card(match):
        svg_content = match.group(0)
        return f'<div style="text-align: center; margin: 12px 0;"><div style="display: inline-block; background-color: #ffffff; padding: 12px 18px; border-radius: 8px; border: 1px solid #d0d0d0; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">{svg_content}</div></div>'
    text = re.sub(r'(<svg[\s\S]*?<\/svg>)', wrap_svg_card, text)
    
    return text

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
    for idx, p in enumerate(items, start=1):
        q1 = format_math(p.get("q1", "")).replace('\n', '<br>')
        q2 = format_math(p.get("q2", "")).replace('\n', '<br>')
        html_pages += f'<div class="a4-page"><div class="header">📐 {title} (세트 {idx})</div><div class="problem-container">[문제 1] {q1}<div class="work-space"></div></div><div class="problem-container">[문제 2] {q2}<div class="work-space"></div></div></div>'
    return f"<html><style>@page {{size: A4; margin: 10mm;}} .a4-page {{height: 270mm; page-break-after: always;}} .work-space {{height: 80px; border: 1px dotted #999;}}</style><body>{html_pages}</body></html>"

# ==========================================
# ★ 메인 로직
# ==========================================
mathpix_app_id = st.secrets.get("MATHPIX_APP_ID", "")
mathpix_app_key = st.secrets.get("MATHPIX_APP_KEY", "")
gemini_api_key = st.secrets.get("GEMINI_API_KEY", "")

tab1, tab2 = st.tabs(["📋 게시판", "📸 문제 생성"])

with tab2:
    st.subheader("📸 문제 생성기")
    uploaded_file = st.file_uploader("문제 사진 업로드", type=["png", "jpg", "jpeg"])
    
    if uploaded_file and st.button("추출"):
        st.session_state.current_image_b64 = base64.b64encode(uploaded_file.getvalue()).decode('utf-8')
        # ... (OCR 로직 동일) ...
        st.success("추출 완료!")

    if st.session_state.get("ocr_text"):
        if st.button("✨ 유사 문제 2개 생성"):
            with st.spinner("AI가 문제를 생성 중입니다 (간단한 그래프 모드)..."):
                # ★ 최적화된 프롬프트: 그래프 생성 시간을 최소화
                prompt = f"""
                너는 수학 출제 위원이야. 원본 문제의 그래프 유형에 따라 다음을 준수해:
                
                [그래프 생성 규칙 - 최적화 모드]
                1. 꺾은선그래프나 막대그래프인 경우, 복잡한 격자망(Grid)을 최소화하고 축과 데이터 막대/점만 명확하게 그리는 가벼운 SVG를 생성해라.
                2. 시간 단축을 위해 복잡한 좌표 계산이 필요한 격자선은 꼭 필요한 수준으로 줄여라.
                3. 모든 텍스트 레이블(숫자, 축 이름)은 검정색(`fill="#000000"`)으로 출력해라.
                
                [원본 문제]
                {st.session_state.ocr_text}

                [출력 양식]
                [문제 1]
                (내용)
                [정답 1]
                (내용)
                [풀이 1]
                (내용)
                [문제 2]
                (내용)
                [정답 2]
                (내용)
                [풀이 2]
                (내용)
                """
                model = genai.GenerativeModel(get_fastest_model_name(gemini_api_key))
                response = model.generate_content(prompt)
                problems = parse_tag_problems(response.text.strip())
                if problems:
                    st.session_state.similar_problems = problems
                    st.success("생성 완료!")

        if st.session_state.similar_problems:
            # (수정 에디터는 그대로 사용)
            pass
