import streamlit as st
import requests
import json
import base64
import re
import os
import time
import google.generativeai as genai

# 페이지 기본 설정
st.set_page_config(page_title="수학 유사 문제 생성기", layout="centered")

st.title("📐 AI 수학 온라인 클래스룸")
st.caption("선생님의 추천 과제를 풀거나, 모르는 문제를 직접 찍어 유사 문제를 만들어보세요!")

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
# 사이드바: 관리자 및 API 설정
# ==========================================
with st.sidebar:
    st.header("🔑 API 설정 (선생님 전용)")
    mathpix_app_id = st.secrets.get("MATHPIX_APP_ID", "")
    mathpix_app_key = st.secrets.get("MATHPIX_APP_KEY", "")
    gemini_api_key = st.secrets.get("GEMINI_API_KEY", "")
    
    if not mathpix_app_id:
        mathpix_app_id = st.text_input("Mathpix App ID", type="password")
    if not mathpix_app_key:
        mathpix_app_key = st.text_input("Mathpix App Key", type="password")
    if not gemini_api_key:
        gemini_api_key = st.text_input("Gemini API Key", type="password")
        
    st.divider()
    
    st.header("👨‍🏫 수업 시간 관리 (스위치)")
    real_admin_pw = st.secrets.get("ADMIN_PASSWORD", "1234") 
    input_pw = st.text_input("관리자 비밀번호를 입력하세요", type="password")
    
    is_admin = (input_pw == real_admin_pw)
    current_status = get_app_status()
    
    if is_admin:
        st.success("✅ 선생님 인증 완료!")
        new_status = st.radio(
            "학생 접속 스위치 조작", 
            ["ON (수업 중)", "OFF (잠금)"], 
            index=0 if current_status == "ON" else 1
        )
        
        if "ON" in new_status and current_status == "OFF":
            set_app_status("ON")
            st.rerun()
        elif "OFF" in new_status and current_status == "ON":
            set_app_status("OFF")
            st.rerun()
    else:
        if input_pw:
            st.error("비밀번호가 틀렸습니다.")
        st.info("비밀번호를 입력해야 스위치가 나타납니다.")

# ==========================================
# 학생 접속 차단 로직
# ==========================================
if not is_admin and get_app_status() == "OFF":
    st.error("⛔ 현재는 수학 앱 사용 시간이 아닙니다.")
    st.info("💡 선생님이 수업 시간에 접속을 열어주시면 다시 새로고침(F5) 해주세요!")
    st.stop()

# ==========================================
# 메인 화면: 두 개의 탭
# ==========================================
tab1, tab2 = st.tabs(["📋 선생님 추천 과제", "📸 스스로 문제 만들기"])

# ------------------------------------------
# [탭 1] 학생 게시판
# ------------------------------------------
with tab1:
    st.subheader("📋 선생님이 올려주신 오늘의 과제")
    problems_db = load_db()
    
    if not problems_db:
        st.info("아직 등록된 과제가 없습니다. 선생님이 문제를 올려주실 때까지 기다려주세요!")
    else:
        for p in problems_db:
            with st.container():
                st.markdown(f"#### 📝 과제 등록일: {p['date']}")
                
                if p.get("image_b64"):
                    st.image(f"data:image/jpeg;base64,{p['image_b64']}", use_container_width=True)
                
                # [해결 핵심] \n 명령어를 실제 화면 줄바꿈(\n\n)으로 변환
                q1_safe = p["q1"].replace('\\n', '\n\n')
                a1_safe = p["a1"].replace('\\n', '\n\n')
                q2_safe = p["q2"].replace('\\n', '\n\n')
                a2_safe = p["a2"].replace('\\n', '\n\n')
                
                st.markdown("### [문제 1] 기본 다지기 (숫자 변형)")
                st.markdown(q1_safe)
                with st.expander("🔍 1번 정답 및 풀이 확인"):
                    st.info(a1_safe)
                
                st.markdown("### [문제 2] 실력 키우기 (응용 변형)")
                st.markdown(q2_safe)
                with st.expander("🔍 2번 정답 및 풀이 확인"):
                    st.info(a2_safe)
                
                if is_admin:
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
    
    if "ocr_text" not in st.session_state:
        st.session_state.ocr_text = ""
    if "similar_problems" not in st.session_state:
        st.session_state.similar_problems = None
    if "current_image_b64" not in st.session_state:
        st.session_state.current_image_b64 = None

    uploaded_file = st.file_uploader("문제 사진을 찍거나 업로드하세요", type=["png", "jpg", "jpeg"], key="uploader")

    if uploaded_file and st.button("📸 사진에서 수식 추출하기"):
        if not (mathpix_app_id and mathpix_app_key):
            st.error("Mathpix API 정보를 입력해 주세요.")
        else:
            with st.spinner("Mathpix AI가 수식을 인식하는 중..."):
                try:
                    base64_image = base64.b64encode(uploaded_file.getvalue()).decode('utf-8')
                    st.session_state.current_image_b64 = base64_image 
                    image_url = f"data:image/jpeg;base64,{base64_image}"
                    
                    headers = {
                        "app_id": mathpix_app_id,
                        "app_key": mathpix_app_key,
                        "Content-type": "application/json"
                    }
                    data = {"src": image_url, "formats": ["text", "latex_styled"]}
                    
                    res = requests.post("https://api.mathpix.com/v3/text", headers=headers, json=data)
                    result_json = res.json()
                    
                    if "text" in result_json:
                        math_text = result_json["text"]
                        math_text = re.sub(r'\\\(\s*', '$', math_text); math_text = re.sub(r'\s*\\\)', '$', math_text); math_text = re.sub(r'\\\[\s*', '$$', math_text); math_text = re.sub(r'\s*\\\]', '$$', math_text);
                        
                        st.session_state.ocr_text = math_text
                        st.success("수식 추출 성공! 내용을 확인하고 필요시 수정해 주세요.")
                    else:
                        st.error("인식에 실패했습니다. 다시 시도해 주세요.")
                except Exception as e:
                    st.error(f"오류가 발생했습니다: {e}")

    # 텍스트 검수 및 생성 버튼
    if st.session_state.ocr_text:
        if st.session_state.current_image_b64:
            st.image(f"data:image/jpeg;base64,{st.session_state.current_image_b64}", caption="[원본 도형 이미지]", use_container_width=True)

        edited_text = st.text_area("도형 조건이나 수식 중 누락된 부분을 수정하세요:", value=st.session_state.ocr_text, height=150)
        st.session_state.ocr_text = edited_text
        
        st.markdown("**수식 렌더링 미리보기:**")
        # 줄바꿈 변환 적용
        st.markdown(edited_text.replace('\\n', '\n\n'))
        
        if st.button("✨ 유사 문제 2개 초고속 생성 (기본1 + 응용1)", type="primary"):
            if not gemini_api_key:
                st.error("Gemini API Key를 입력해 주세요.")
            else:
                with st.spinner("Gemini가 빛의 속도로 문제를 출제하고 있습니다..."):
                    try:
                        fast_model_name = get_fastest_model_name(gemini_api_key)
                        model = genai.GenerativeModel(fast_model_name)
                        
                        prompt = f"""
                        너는 학생들의 수준별 학습을 돕는 꼼꼼한 수학 교과 출제 위원이야. 
                        다음 [원본 문제]를 바탕으로 성격이 다른 [유사 문제] 딱 2개를 만들어줘.
                        
                        [원본 문제]
                        {edited_text}
                        
                        [출제 원칙]
                        1번 문제: 원본 문제와 똑같이 유지하고 '숫자나 조건'만 살짝 바꿔줘.
                        2번 문제: 핵심 개념은 유지하되 묻는 방식을 다르게 비튼 응용 문제로 만들어줘.
                        
                        [출력 형식]
                        오직 JSON 형식으로만 반환해줘. 데이터 구조는 {{ "problems": [ {{"problem_num": 1, "question": "문제내용", "answer": "정답내용"}}, {{"problem_num": 2, "question": "문제내용", "answer": "정답내용"}} ] }} 로 작성해.
                        ⚠️[매우 중요] 수식에 백슬래시(\\)가 포함된 경우(예: \\angle, \\mathrm), JSON 오류가 나지 않도록 반드시 이중 백슬래시(\\\\)로 이스케이프 처리해서 출력해.
                        ```json 기호 없이 순수한 JSON 텍스트만 출력해.
                        """
                        
                        response = model.generate_content(prompt)
                        res_text = response.text.strip()
                        if res_text.startswith("```json"): res_text = res_text[7:-3].strip()
                        elif res_text.startswith("```"): res_text = res_text[3:-3].strip()
                            
                        try:
                            parsed = json.loads(res_text)
                        except json.JSONDecodeError:
                            safe_res_text = res_text.replace('\\', '\\\\')
                            safe_res_text = safe_res_text.replace('\\\\"', '\\"') 
                            safe_res_text = safe_res_text.replace('\\\\n', '\\n') 
                            parsed = json.loads(safe_res_text)
                            
                        problems = parsed.get("problems", [])
                        
                        if problems:
                            st.session_state.similar_problems = problems
                            st.success(f"⚡ 생성 완료! (사용된 모델: {fast_model_name})")
                        else:
                            st.error("문제 생성에 실패했습니다. 다시 시도해 주세요.")
                            
                    except Exception as e:
                        st.error(f"오류가 발생했습니다: {e}")

    # 생성된 문제 결과 및 '게시판 공유' 기능
    if st.session_state.similar_problems:
        st.divider()
        st.subheader("🎯 생성된 연습 문제")
        
        if is_admin:
            if st.button("📢 이 문제를 학생 게시판에 등록하기", type="primary"):
                import datetime
                new_prob = {
                    "id": str(int(time.time())),
                    "date": datetime.datetime.now().strftime("%Y-%m-%d
