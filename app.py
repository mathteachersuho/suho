import streamlit as st
import requests
import json
import base64
from openai import OpenAI

# 페이지 기본 설정
st.set_page_config(page_title="수학 유사 문제 생성기", layout="centered")

st.title("📐 AI 수학 유사 문제 생성기")
st.caption("선생님이 사진을 올리면 즉석에서 유사 문제 3개를 생성합니다.")

# 사이드바: API 키 설정 (Streamlit Secrets 미설정 시 수동 입력 지원)
with st.sidebar:
    st.header("🔑 API 설정")
    mathpix_app_id = st.secrets.get("MATHPIX_APP_ID", "")
    mathpix_app_key = st.secrets.get("MATHPIX_APP_KEY", "")
    openai_api_key = st.secrets.get("OPENAI_API_KEY", "")
    
    if not mathpix_app_id:
        mathpix_app_id = st.text_input("Mathpix App ID", type="password")
    if not mathpix_app_key:
        mathpix_app_key = st.text_input("Mathpix App Key", type="password")
    if not openai_api_key:
        openai_api_key = st.text_input("OpenAI API Key", type="password")

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

# 2. 추출된 텍스트 확인 및 수정 (선생님 검수 단계)
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
        if not openai_api_key:
            st.error("OpenAI API Key를 입력해 주세요.")
        else:
            with st.spinner("AI가 유사 문제를 출제하고 있습니다..."):
                try:
                    client = OpenAI(api_key=openai_api_key)
                    prompt = f"""
                    너는 꼼꼼한 수학 교과 출제 위원이야. 
                    다음 [원본 문제]의 난이도와 풀이 과정을 완벽히 유지하되, 숫자와 조건만 살짝 바꾼 [유사 문제] 3개를 만들어줘.
                    
                    [원본 문제]
                    {edited_text}
                    
                    [출력 형식]
                    JSON 형식으로 반환해줘. 각 문제 객체는 'problem_num', 'question', 'answer' 키를 가져야 해.
                    수식은 LaTeX 문법($ 또는 $$)을 정확히 사용할 것.
                    반드시 유효한 JSON 포맷만 출력해.
                    """
                    
                    response = client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[{"role": "user", "content": prompt}],
                        response_format={"type": "json_object"}
                    )
                    
                    res_content = response.choices[0].message.content
                    parsed = json.loads(res_content)
                    
                    # JSON 키 유연하게 파싱
                    problems = parsed.get("problems", parsed.get("questions", []))
                    if not problems and isinstance(parsed, dict):
                        # 딕셔너리 내 첫 번째 리스트 값 추출
                        for val in parsed.values():
                            if isinstance(val, list):
                                problems = val
                                break
                    st.session_state.similar_problems = problems
                    st.success("유사 문제 출제 완료!")
                except Exception as e:
                    st.error(f"생성 중 오류가 발생했습니다: {e}")

# 4. 학생 풀이 화면 (문제 및 정답 표시)
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
