"""Supabase(Postgres) 연결 확인.

앱이 데이터베이스에 접속할 수 있는지, 표가 다 만들어져 있는지, 접근 제한(RLS)이 켜져 있는지 본다.
(이 단계에서는 읽기만 하고 아무것도 바꾸지 않는다. 기능별 읽기·쓰기는 다음 단계에서 이 위에 얹는다.)
"""
import time
from urllib.parse import urlsplit, unquote

import psycopg

# db/schema.sql 이 만드는 표 13개
EXPECTED_TABLES = (
    "students", "taxonomy", "units", "problem_sets", "problems", "assignments", "stars",
    "homework", "homework_students", "homework_problems", "hw_results", "exams", "app_settings",
)


def _mask(text, url):
    """오류 문장에 연결 주소나 비밀번호가 섞여 있으면 *** 로 가린다."""
    text = str(text)
    secrets = [url]
    try:
        pw = urlsplit(url).password
        if pw:
            secrets += [pw, unquote(pw)]
    except ValueError:
        pass
    for s in secrets:
        if s:
            text = text.replace(s, "***")
    return text


def ping(url, timeout=10):
    """연결해서 상태를 돌려준다.
    {ok, error, ms, version, found, missing, rls_off}  (ok가 False면 error만 의미 있음)"""
    url = (url or "").strip()
    if not url:
        return {"ok": False, "error": "연결 주소가 비어 있습니다."}
    started = time.monotonic()
    try:
        # 트랜잭션 풀러(포트 6543)는 prepared statement를 지원하지 않으므로 끈다.
        with psycopg.connect(url, connect_timeout=timeout, prepare_threshold=None) as conn:
            with conn.cursor() as cur:
                cur.execute("show server_version")
                version = cur.fetchone()[0]
                cur.execute(
                    "select c.relname, c.relrowsecurity from pg_class c "
                    "join pg_namespace n on n.oid = c.relnamespace "
                    "where n.nspname = 'public' and c.relkind = 'r'"
                )
                rows = {name: rls for name, rls in cur.fetchall()}
    except Exception as e:  # 접속 실패, 시간 초과, 비밀번호 오류 등
        return {"ok": False, "error": _mask(f"{type(e).__name__}: {e}", url)}
    found = [t for t in EXPECTED_TABLES if t in rows]
    return {
        "ok": True,
        "ms": int((time.monotonic() - started) * 1000),
        "version": version,
        "found": found,
        "missing": [t for t in EXPECTED_TABLES if t not in rows],
        "rls_off": [t for t in found if not rows[t]],
    }
