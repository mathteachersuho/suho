"""Supabase(Postgres) 연결 확인.

앱이 데이터베이스에 접속할 수 있는지, 표가 다 만들어져 있는지, 접근 제한(RLS)이 켜져 있는지 본다.
(이 단계에서는 읽기만 하고 아무것도 바꾸지 않는다. 기능별 읽기·쓰기는 다음 단계에서 이 위에 얹는다.)
"""
import hmac
import logging
import time
from urllib.parse import urlsplit, unquote

import psycopg
from psycopg import errors as pgerrors
from psycopg_pool import ConnectionPool

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
    {ok, error, ms, version, found, missing, rls_off, bypass_rls}  (ok가 False면 error만 의미 있음)"""
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
                # 앱은 접근 제한(RLS)이 켜진 표를 읽고 써야 하므로, 이 계정이 RLS를 건너뛸 수 있는지 본다.
                cur.execute("select rolbypassrls or rolsuper from pg_roles where rolname = current_user")
                bypass_rls = bool(cur.fetchone()[0])
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
        "bypass_rls": bypass_rls,
    }


class Db:
    """앱이 쓰는 데이터베이스 접속(연결 묶음 포함)과 기능별 읽기·쓰기.
    쓰기 함수는 Apps Script와 같은 모양({"ok": True/False, "error": ...})으로 돌려주고,
    읽기 함수는 값을 돌려주되 연결 오류는 예외로 올린다(앱이 화면 문구를 정한다)."""

    def __init__(self, url):
        self.url = url.strip()
        # 트랜잭션 풀러(포트 6543)는 prepared statement를 지원하지 않으므로 끈다.
        # check: 서버가 오래 놀던 연결을 끊었을 수 있으니 꺼낼 때마다 살아 있는지 확인한다.
        self.pool = ConnectionPool(
            self.url, min_size=1, max_size=4, timeout=15, open=True,
            check=ConnectionPool.check_connection,
            kwargs={"connect_timeout": 10, "prepare_threshold": None},
        )

    def _fail(self, e):
        # 화면에는 일반 문구만 보내고, 자세한 내용은 비밀값을 가린 채 서버 로그에만 남긴다.
        logging.error("DB 오류: %s", _mask(f"{type(e).__name__}: {e}", self.url))
        return {"ok": False, "error": "데이터베이스 오류가 발생했어요. 잠시 후 다시 시도해 주세요."}

    # ---------- 학생 계정 ----------
    def signup(self, student_id, pw_hash):
        student_id = (student_id or "").strip()
        if not student_id or not pw_hash:
            return {"ok": False, "error": "아이디/비밀번호를 입력해주세요."}
        try:
            with self.pool.connection() as conn:
                conn.execute(
                    "insert into students (student_id, password_hash, class_id) values (%s, %s, '')",
                    (student_id, pw_hash),
                )
            return {"ok": True, "class_id": ""}
        except pgerrors.UniqueViolation:
            return {"ok": False, "error": "이미 사용 중인 아이디입니다."}
        except Exception as e:
            return self._fail(e)

    def login(self, student_id, pw_hash):
        student_id = (student_id or "").strip()
        try:
            with self.pool.connection() as conn:
                row = conn.execute(
                    "select password_hash, class_id from students where student_id = %s", (student_id,)
                ).fetchone()
        except Exception as e:
            return self._fail(e)
        if not row:
            return {"ok": False, "error": "존재하지 않는 아이디입니다."}
        if hmac.compare_digest(str(row[0]), str(pw_hash or "")):
            return {"ok": True, "class_id": row[1] or ""}
        return {"ok": False, "error": "비밀번호가 일치하지 않습니다."}

    def assign_class(self, student_id, class_id):
        try:
            with self.pool.connection() as conn:
                cur = conn.execute(
                    "update students set class_id = %s where student_id = %s",
                    ((class_id or "").strip(), (student_id or "").strip()),
                )
                if cur.rowcount == 0:
                    return {"ok": False, "error": "학생을 찾을 수 없습니다."}
            return {"ok": True}
        except Exception as e:
            return self._fail(e)

    def withdraw(self, student_id, pw_hash, by_admin=False):
        """학생 계정과 학생 관련 기록(배정, 중요 표시, 숙제 결과, 시험 점수)을 한 번에 지운다.
        문제 자체는 지우지 않는다. 그 학생에게만 낸 숙제는 지운다(대상이 비면 '반 전체 숙제'가 되므로).
        하나라도 실패하면 아무것도 지워지지 않는다."""
        student_id = (student_id or "").strip()
        if not student_id:
            return {"ok": False, "error": "student_id가 필요합니다."}
        try:
            with self.pool.connection() as conn:
                row = conn.execute(
                    "select password_hash from students where student_id = %s for update", (student_id,)
                ).fetchone()
                if not row:
                    return {"ok": False, "error": "학생을 찾을 수 없습니다."}
                if not by_admin and not hmac.compare_digest(str(row[0]), str(pw_hash or "")):
                    return {"ok": False, "error": "비밀번호가 일치하지 않습니다."}

                def count(table):
                    return conn.execute(
                        f"select count(*) from {table} where student_id = %s", (student_id,)
                    ).fetchone()[0]

                removed = {
                    "personal": 0,  # 예전 개인 보관함은 새 구조에 없다
                    "stars": count("stars"),
                    "hw_results": count("hw_results"),
                    "exams": count("exams"),
                    "archive": count("assignments"),
                    "homework": count("homework_students"),
                }
                conn.execute(
                    "delete from homework where hw_id in ("
                    " select hw_id from homework_students group by hw_id"
                    " having count(*) = 1 and bool_or(student_id = %s))",
                    (student_id,),
                )
                conn.execute("delete from students where student_id = %s", (student_id,))
            return {"ok": True, "removed": removed}
        except Exception as e:
            return self._fail(e)

    def list_students(self):
        with self.pool.connection() as conn:
            rows = conn.execute(
                "select student_id, class_id from students order by created_at, student_id"
            ).fetchall()
        return [{"student_id": r[0], "class_id": r[1] or ""} for r in rows]

    # ---------- 앱 ON/OFF 스위치 ----------
    def get_status(self):
        with self.pool.connection() as conn:
            row = conn.execute("select value from app_settings where key = 'app_status'").fetchone()
        return row[0] if row else "OFF"

    def set_status(self, status):
        if status not in ("ON", "OFF"):
            return {"ok": False, "error": "status는 ON 또는 OFF 여야 합니다."}
        try:
            with self.pool.connection() as conn:
                conn.execute(
                    "insert into app_settings (key, value) values ('app_status', %s) "
                    "on conflict (key) do update set value = excluded.value, updated_at = now()",
                    (status,),
                )
            return {"ok": True}
        except Exception as e:
            return self._fail(e)
