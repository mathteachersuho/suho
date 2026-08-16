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
st.set_page_config(page_title="수학 유사 문제 생성기", layout="centered")

st.title("📐 AI 수학 온라인 클래스룸")

# ==========================================
# ★ 로컬 데이터베이스(게시판) 설정
# ==========================================
DB_FILE = "shared_problems.json"
STATUS_FILE = "app_status.txt"

def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def save_db(data):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_app_status():
    if os.path.exists(STATUS_FILE):
        with open(STATUS_FILE, "r") as f:
            return f.read().strip()
    return "OFF"

def set_app_status(status):
    with open(STATUS_FILE, "w") as f:
        f.write(status)

# ==========================================
# ★ 수식 렌더링 전용 함수
# ==========================================
def format_math(text):
    if not text:
        return ""
    text = text.replace('[br]', '\n\n')
    return text

# ==========================================
# ★ 속도 개선 로직
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
# [탭 1] 학생 게시판
# ------------------------------------------
with tab1:
    problems_db = load_db()
    
    if current_role == "admin":
        view_class = st.selectbox("👀 조회할 반 게시판을 선택하세요", class_list)
    else:
        view_class = current_role
        
    st.subheader(f"📋 [{view_class}] 과제 게시판")
    
    filtered_problems = [p for p in problems_db if p.get("class_id", "1M2") == view_class]
    
    if not filtered_problems:
        st.info("아직 등록된 과제가 없습니다.")
    else:
        for p in filtered_problems:
            with st.container():
                st.markdown(f"#### 📝 과제 등록일: {p['date']}")
                
                if p.get("image_b64"):
                    st.image(f"data:image/jpeg;base64,{p['image_b64']}", use_container_width=True)
                
                q1_safe = format_math(p.get("q1", ""))
                a1_safe = format_math(p.get("a1", ""))
                s1_safe = format_math(p.get("s1", ""))
                
                q2_safe = format_math(p.get("q2", ""))
                a2_safe = format_math(p.get("a2", ""))
                s2_safe = format_math(p.get("s2", ""))
                
                st.markdown("### [문제 1] 기본 다지기")
                st.markdown(q1_safe)
                with st.expander("🔍 1번 정답 및 풀이 확인"):
                    st.markdown(f"**정답:** {a1_safe}")
                    if s1_safe:
                        st.markdown(f"**풀이 및 해설:**\n\n{s1_safe}")
                
                st.markdown("### [문제 2] 실력 키우기")
                st.markdown(q2_safe)
                with st.expander("🔍 2번 정답 및 풀이 확인"):
                    st.markdown(f"**정답:** {a2_safe}")
                    if s2_safe:
                        st.markdown(f"**풀이 및 해설:**\n\n{s2_safe}")
                
                if current_role == "admin":
                    if st.button("🗑️ 이 과제 삭제하기", key=f"del_{p['id']}"):
                        problems_db = [x for x in problems_db if x['id'] != p['id']]
                        save_db(problems_db)
                        st.rerun()
            st.divider()

# ------------------------------------------
# [탭 2] 개인용 문제 생성기
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
        
        if st.button("✨ 유사 문제 2개 초고속 생성 (기본1 + 응용1)", type="primary"):
            with st.spinner("Gemini가 빛의 속도로 문제를 출제하고 있습니다..."):
                try:
                    fast_model_name = get_fastest_model_name(gemini_api_key)
                    model = genai.GenerativeModel(fast_model_name)
                    
                    # ★ 프롬프트에 'answer(정답)'와 'solution(상세 해설)' 항목을 명확히 분리하여 지시
                    prompt = f"""
                    너는 학생들의 수준별 학습을 돕는 꼼꼼한 수학 교과 출제 위원이야. 
                    다음 [원본 문제]를 바탕으로 성격이 다른 [유사 문제] 딱 2개를 만들어줘.
                    
                    [원본 문제]
                    {edited_text}
                    
                    [출제 원칙]
                    1번 문제: 원본 문제와 똑같이 유지하고 '숫자나 조건'만 살짝 바꿔줘.
                    2번 문제: 핵심 개념은 유지하되 묻는 방식을 다르게 비튼 응용 문제로 만들어줘.
                    
                    [출력 형식]
                    오직 JSON 형식으로만 반환해줘. 데이터 구조는 {{ "problems": [ {{"problem_num": 1, "question": "문제내용", "answer": "정답", "solution": "학생들이 이해하기 쉽도록 단계별로 작성한 상세한 풀이 및 해설"}}, {{"problem_num": 2, "question": "문제내용", "answer": "정답", "solution": "상세한 풀이 및 해설"}} ] }} 로 작성해.
                    
                    ⚠️[매우 중요 1] 수식 기호 안에는 한글을 섞지 말고 순수 수학 기호만 넣어. (예: `$x=2$` 이므로)
                    ⚠️[매우 중요 2] JSON 파싱 오류를 막기 위해 수식의 백슬래시는 반드시 두 개씩 적어! (❌ `\frac`, `\notin` ➔ ⭕ `\\\\frac`, `\\\\notin`)
                    ⚠️[매우 중요 3] 줄바꿈이 필요할 때는 절대로 `\\n`을 쓰지 말고 `[br]` 이라고 적어! (예: 첫 번째 줄[br]두 번째 줄)
                    ⚠️[매우 중요 4] `solution` 항목에는 정답을 도출하는 전 과정(해설)을 반드시 친절하고 상세하게 적어줘.
                    
                    ```json 기호 없이 순수한 JSON 텍스트만 출력해.
                    """
                    
                    response = model.generate_content(prompt)
                    res_text = response.text.strip()
                    if res_text.startswith("```json"): res_text = res_text[7:-3].strip()
                    elif res_text.startswith("```"): res_text = res_text[3:-3].strip()
                        
                    try:
                        parsed = json.loads(res_text)
                    except json.JSONDecodeError:
                        safe_res_text = res_text.replace('\\', '\\\\'); safe_res_text = safe_res_text.replace('\\\\"', '\\"'); parsed = json.loads(safe_res_text)
                        
                    problems = parsed.get("problems", [])
                    if problems:
                        st.session_state.similar_problems = problems
                        st.success(f"⚡ 생성 완료! (사용된 모델: {fast_model_name})")
                    else:
                        st.error("문제 생성에 실패했습니다.")
                except Exception as e:
                    st.error(f"오류가 발생했습니다: {e}")

        if st.session_state.similar_problems:
            st.divider()
            st.subheader("🎯 생성된 연습 문제")
            
            if current_role == "admin":
                st.info("💡 이 문제를 특정 반 학생들에게 숙제로 낼 수 있습니다.")
                col1, col2 = st.columns([1, 2])
                with col1:
                    target_class = st.selectbox("게시할 반", class_list)
                with col2:
                    st.write("") 
                    st.write("") 
                    if st.button(f"📢 [{target_class}] 게시판에 등록하기", type="primary"):
                        new_prob = {
                            "id": str(int(time.time())),
                            "class_id": target_class, 
                            "date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                            "image_b64": st.session_state.current_image_b64,
                            "q1": st.session_state.similar_problems[0]["question"],
                            "a1": st.session_state.similar_problems[0]["answer"],
                            "s1": st.session_state.similar_problems[0].get("solution", ""),
                            "q2": st.session_state.similar_problems[1]["question"],
                            "a2": st.session_state.similar_problems[1]["answer"],
                            "s2": st.session_state.similar_problems[1].get("solution", ""),
                        }
                        curr_db = load_db()
                        curr_db.insert(0, new_prob) 
                        save_db(curr_db)
                        st.success(f"✅ [{target_class}] 게시판에 성공적으로 등록되었습니다!")
                    
            for idx, item in enumerate(st.session_state.similar_problems, start=1):
                with st.container():
                    st.markdown(f"### [문제 {idx}] {'기본 다지기' if idx==1 else '실력 키우기'}")
                    display_q = format_math(item.get("question", ""))
                    display_a = format_math(item.get("answer", ""))
                    display_s = format_math(item.get("solution", ""))
                    
                    st.markdown(display_q)
                    with st.expander("🔍 정답 및 풀이 확인"):
                        st.markdown(f"**정답:** {display_a}")
                        if display_s:
                            st.markdown(f"**풀이 및 해설:**\n\n{display_s}")
                    st.write("")
