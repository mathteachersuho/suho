import streamlit as st
import requests
import json
import base64
import re
import os
import time
import datetime
from concurrent.futures import ThreadPoolExecutor
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
    """구글 시트에 새 과제 추가하기 (학급 공용 or 개인 보관함)"""
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
# ★ 수식 렌더링, 전개도 맞춤 표, SVG 통합 엔진
# ==========================================
def convert_frac_to_html(text):
    """분수(\\frac{a}{b})를 HTML 세로 분수로 변환하여 표/셀 내부 깨짐 방지"""
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
    text = re.sub(r'
http://googleusercontent.com/immersive_entry_chip/0
