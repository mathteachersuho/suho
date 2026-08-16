import streamlit as st
import requests
import json
import base64
import re
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
                    # [최강 방어 코드] 줄바꿈이 사라져도 절대 에러가 나지 않도록 코드를 한 줄로 단단하게 묶었습니다.
                    math_text = result_json["text"].replace(r"\(", " $ ").replace(r"\)", " $ ").replace(r"\[", " $$ ").replace(r"\]", " $$ ")
                    
                    # 혹시 공백이 너무 길어졌다면 1칸으로 깔끔하게 정리합니다.
                    math_text = re.sub(r' +', ' ', math_text)
                    
                    st.session_state.ocr_text = math_text
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
    
    # 3. 유사 문제 생성 버튼
    if st.button("✨ 유사 문제 3개 생성하기", type="primary"):
        if not gemini_api_key:
            st.error("Gemini API Key를 입력해 주세요.")
        else:
            with st.spinner("Gemini가 유사 문제를 출제하고 있습니다..."):
                try:
                    genai.configure(api_key=gemini_api_key)
                    
                    available_models = [m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
                    safe_models = [m for m in available_models if '2.5-flash' not in m]
                    
                    prompt = f"""
                    너는 꼼꼼한 수학 교과 출제 위원이야. 
                    다음 [원본 문제]의 난이도와 풀이 과정을 완벽히 유지하되, 숫자와 조건만 살짝 바꾼 [유사 문제] 3개를 만들어줘.
                    
                    [원본 문제]
                    {edited_text}
                    
                    [출력 형식]
                    오직 JSON 형식으로만 반환해줘. 데이터 구조는 {{ "problems": [ {{"problem_num": 1, "question": "문제내용", "answer": "정답내용"}} ] }} 로 작성해.
                    수식은 LaTeX 문법($ 또는 $$)을 정확히 사용하고, 한글 텍스트와 $ 기호 사이에는 반드시 양쪽으로 띄어쓰기를 1칸씩 넣어줘.
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
                                st.success("유사 문제 출제 완료!")
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
    
    for idx, item in enumerate(st.session_state.similar_problems, start=1):
        q_text = item.get("question", "")
        a_text = item.get("answer", "")
        
        with st.container():
            st.markdown(f"### [유사 문제 {idx}]")
            st.markdown(q_text)
            
            with st.expander("🔍 정답 및 풀이 확인"):
                st.info(f"**정답:**\n{a_text}")
            st.write("")
