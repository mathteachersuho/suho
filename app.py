import streamlit as st
import requests
import json
import base64
import re
import google.generativeai as genai

# 페이지 기본 설정
st.set_page_config(page_title="수학 유사 문제 생성기", layout="centered")

st.title("📐 AI 수학 유사 문제 생성기 (Gemini 버전)")
st.caption("사진을 올리면 '숫자 변형 1문제'와 '응용 변형 1문제'를 즉석에서 생성합니다.")

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
                    math_text = result_json["text"]
                    
                    # 수식 변환 및 띄어쓰기 압착 처리
                    math_text = re.sub(r'\\\(\s*', '$', math_text); math_text = re.sub(r'\s*\\\)', '$', math_text); math_text = re.sub(r'\\\[\s*', '$$', math_text); math_text = re.sub(r'\s*\\\]', '$$', math_text);
                    
                    st.session_state.ocr_text = math_text
                    st.success("수식 추출 성공! 내용을 확인하고 필요시 수정해 주세요.")
                else:
                    st.error("인식에 실패했습니다. 다시 시도해 주세요.")
            except Exception as e:
                st.error(f"오류가 발생했습니다: {e}")

# 2. 추출된 텍스트 확인 및 수정
if st.session_state.ocr_text:
    st.subheader("📝 추출된 원본 문제 (검수 및 수정)")
    
    if uploaded_file is not None:
        st.image(uploaded_file, caption="[원본 도형 이미지]", use_container_width=True)
        st.write("") 

    edited_text = st.text_area(
        "도형 조건이나 수식 중 누락된 부분이 있다면 수정하세요:", 
        value=st.session_state.ocr_text, 
        height=150
    )
    st.session_state.ocr_text = edited_text
    
    st.markdown("**수식 렌더링 미리보기:**")
    st.markdown(edited_text)
    
    # 3. 유사 문제 생성 버튼 (버튼 텍스트 수정)
    if st.button("✨ 유사 문제 2개 생성하기 (기본1 + 응용1)", type="primary"):
        if not gemini_api_key:
            st.error("Gemini API Key를 입력해 주세요.")
        else:
            with st.spinner("Gemini가 맞춤형 유사 문제를 출제하고 있습니다..."):
                try:
                    genai.configure(api_key=gemini_api_key)
                    
                    available_models = [m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
                    safe_models = [m for m in available_models if '2.5-flash' not in m]
                    
                    # ★ 핵심 수정: AI에게 내리는 프롬프트(명령어) 상세화
                    prompt = f"""
                    너는 학생들의 수준별 학습을 돕는 꼼꼼한 수학 교과 출제 위원이야. 
                    다음 [원본 문제]를 바탕으로 성격이 다른 [유사 문제] 딱 2개를 만들어줘.
                    
                    [원본 문제]
                    {edited_text}
                    
                    [출제 원칙]
                    1번 문제 (기본 변형): 원본 문제와 풀이 구조, 묻는 방식을 완벽히 똑같이 유지하고 '숫자나 조건'만 살짝 바꿔줘.
                    2번 문제 (응용 변형): 원본 문제의 핵심 수학적 개념은 유지하되, 묻는 방식을 조금 다르게 비틀거나 한 단계 더 생각해야 풀 수 있는 응용 문제로 만들어줘. (예: 각도를 묻던 것을 길이를 묻게 하거나, 조건 하나를 숨기는 등)
                    
                    [출력 형식]
                    오직 JSON 형식으로만 반환해줘. 데이터 구조는 {{ "problems": [ {{"problem_num": 1, "question": "문제내용", "answer": "정답내용"}}, {{"problem_num": 2, "question": "문제내용", "answer": "정답내용"}} ] }} 로 작성해.
                    수식은 LaTeX 문법($ 또는 $$)을 정확히 사용하되, $ 기호 바로 안쪽에는 절대로 공백을 넣지 마 (예: $x$ 금지, $x$ 필수).
                    ```json 같은 마크다운 기호 없이 순수한 JSON 텍스트만 출력해.
                    """
                    
                    success = False
                    last_error = ""
                    
                    for model_name in safe_models:
                        try:
                            model = genai.GenerativeModel(model_name)
                            response = model.generate_content(prompt)
                            
                            res_text = response.text.strip()
                            if res_text.startswith("```json"):
                                res_text = res_text[7:-3].strip()
                            elif res_text.startswith("```"):
                                res_text = res_text[3:-3].strip()
                                
                            parsed = json.loads(res_text)
                            problems = parsed.get("problems", [])
                            
                            if problems:
                                st.session_state.similar_problems = problems
                                st.success("맞춤형 유사 문제 출제 완료!")
                                success = True
                                break
                        except Exception as e:
                            last_error = str(e)
                            continue
                            
                    if not success:
                        st.error(f"문제 생성에 실패했습니다: {last_error}")
                        
                except Exception as e:
                    st.error(f"오류가 발생했습니다: {e}")

# 4. 학생 풀이 화면
if st.session_state.similar_problems:
    st.divider()
    st.subheader("🎯 학생용 연습 문제")
    
    if uploaded_file is not None:
        st.info("💡 아래 문제들은 모두 [참고 도형]의 모양을 기준으로 풀어보세요!")
        st.image(uploaded_file, caption="[참고 도형]", use_container_width=True)
        st.write("") 
    
    for idx, item in enumerate(st.session_state.similar_problems, start=1):
        q_text = item.get("question", "")
        a_text = item.get("answer", "")
        
        with st.container():
            # ★ 추가된 기능: 학생 화면에서 문제가 기본인지 응용인지 명확하게 표시
            if idx == 1:
                st.markdown(f"### [문제 {idx}] 기본 다지기 (숫자 변형)")
            else:
                st.markdown(f"### [문제 {idx}] 실력 키우기 (응용 변형)")
                
            st.markdown(q_text)
            
            with st.expander("🔍 정답 및 풀이 확인"):
                st.info(f"**정답:**\n{a_text}")
            st.write("")
