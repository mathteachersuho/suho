import streamlit as st
import requests
import json
import base64
import google.generativeai as genai

# 페이지 기본 설정
st.set_page_config(page_title="수학 유사 문제 생성기", layout="centered")

st.title("📐 AI 수학 유사 문제 생성기 (Gemini 버전)")
st.caption("선생님이 사진을 올리면 즉석에서 유사 문제 3개를 생성합니다.")

# 사이드바: API 키 설정
with st.sidebar:
    st.header("🔑 API 설정")
    mathpix_app_id = st.secrets.get("MATHPIX_APP_ID", "")
    mathpix_app_key = st.secrets.get("MATHPIX_APP_KEY", "")
    gemini_api_key = st.secrets.get("GEMINI_API_KEY", "")
    
    if not mathpix_app_id:
        mathpix_app_id = st.text_input("Mathpix App ID", type="password")
    if not mathpix_app_key:
        mathpix_app_key = st.text_input("Mathpix App Key", type="password")
    if not gemini_api_key:
        gemini_api_key = st.text_input("Gemini API Key", type="password")

# 세션 상태 초기화
if "ocr_text" not in st.session_state:
    st.session_state.ocr_text = ""
if "similar_problems" not in st.session_state:
    st.session_state.similar_problems = None

# 1. 문제 사진 업로드
uploaded_file = st.file_uploader("문제 사진을 찍거나 업로드하세요", type=["png", "jpg", "jpeg"])

if uploaded_file and st.button("📸 사진에서 수식 및 텍스트 추출하기"):
    if not (mathpix_app_id and mathpix_app_key):
        st.error("Mathpix API 정보를 입력해 주세요.")
    else:
        with st.spinner("Mathpix AI가 수식을 인식하는 중..."):
            try:
                base64_image = base64.b64encode(uploaded_file.getvalue()).decode('utf-8')
                image_url = f"data:image/jpeg;base64,{base64_image}"
                
                headers = {
                    "app_id": mathpix_app_id,
                    "app_key": mathpix_app_key,
                    "Content-type": "application/json"
                }
                data = {
                    "src": image_url,
                    "formats": ["text", "latex_styled"]
                }
                
                res = requests.post("https://api.mathpix.com/v3/text", headers=headers, json=data)
                result_json = res.json()
                
                if "text" in result_json:
                    st.session_state.ocr_text = result_json["text"]
                    st.success("수식 추출 성공! 내용을 확인하고 필요시 수정해 주세요.")
                else:
                    st.error("인식에 실패했습니다. 다시 시도해 주세요.")
            except Exception as e:
                st.error(f"오류가 발생했습니다: {e}")

# 2. 추출된 텍스트 확인 및 수정
if st.session_state.ocr_text:
    st.subheader("📝 추출된 원본 문제 (검수 및 수정)")
    edited_text = st.text_area(
        "도형 조건이나 수식 중 누락된 부분이 있다면 수정하세요:", 
        value=st.session_state.ocr_text, 
        height=150
    )
    st.session_state.ocr_text = edited_text
    
    st.markdown("**수식 렌더링 미리보기:**")
    st.markdown(edited_text)
    
    # 3. 유사 문제 생성 버튼 (Gemini 연결 부분)
    if st.button("✨ 유사 문제 3개 생성하기", type="primary"):
        if not gemini_api_key:
            st.error("Gemini API Key를 입력해 주세요.")
        else:
            with st.spinner("Gemini가 유사 문제를 출제하고 있습니다..."):
                try:
                    # Gemini API 설정
                    genai.configure(api_key=gemini_api_key)
                    
                    # 💡 오류 해결: 현재 계정에서 사용 가능한 최신 모델을 자동으로 찾습니다.
                    available_models = [m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
                    flash_models = [m for m in available_models if 'flash' in m]
                    target_model_name = flash_models[0] if flash_models else "gemini-pro"
                    
                    # 자동으로 찾은 모델을 적용하고 JSON 형태로 설정
                    model = genai.GenerativeModel(
                        target_model_name,
                        generation_config={"response_mime_type": "application/json"}
                    )
                    
                    prompt = f"""
                    너는 꼼꼼한 수학 교과 출제 위원이야. 
                    다음 [원본 문제]의 난이도와 풀이 과정을 완벽히 유지하되, 숫자와 조건만 살짝 바꾼 [유사 문제] 3개를 만들어줘.
                    
                    [원본 문제]
                    {edited_text}
                    
                    [출력 형식]
                    JSON 형식으로 반환해줘. 데이터 구조는 {{ "problems": [ {{"problem_num": 1, "question": "문제내용", "answer": "정답내용"}} ] }} 로 작성해.
                    수식은 LaTeX 문법($ 또는 $$)을 정확히 사용할 것.
                    """
                    
                    response = model.generate_content(prompt)
                    parsed = json.loads(response.text)
                    
                    problems = parsed.get("problems", [])
                    st.session_state.similar_problems = problems
                    st.success("유사 문제 출제 완료!")
                except Exception as e:
                    st.error(f"생성 중 오류가 발생했습니다: {e}")

# 4. 학생 풀이 화면
if st.session_state.similar_problems:
    st.divider()
    st.subheader("🎯 학생용 연습 문제")
    
    for idx, item in enumerate(st.session_state.similar_problems, start=1):
        q_text = item.get("question", "")
        a_text = item.get("answer", "")
        
        with st.container():
            st.markdown(f"### [유사 문제 {idx}]")
            st.markdown(q_text)
            
            with st.expander("🔍 정답 및 풀이 확인"):
                st.info(f"**정답:** {a_text}")
            st.write("")
