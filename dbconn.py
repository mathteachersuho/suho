"""Supabase(Postgres) 연결 확인.

앱이 데이터베이스에 접속할 수 있는지, 표가 다 만들어져 있는지, 접근 제한(RLS)이 켜져 있는지 본다.
(이 단계에서는 읽기만 하고 아무것도 바꾸지 않는다. 기능별 읽기·쓰기는 다음 단계에서 이 위에 얹는다.)
"""
import datetime
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
                # 요청 한 번이 오가는 데 걸리는 시간(평균). 화면이 느린지 판단하는 기준이 된다.
                t0 = time.monotonic()
                for _ in range(5):
                    cur.execute("select 1")
                    cur.fetchone()
                rtt_ms = int((time.monotonic() - t0) * 1000 / 5)
    except Exception as e:  # 접속 실패, 시간 초과, 비밀번호 오류 등
        return {"ok": False, "error": _mask(f"{type(e).__name__}: {e}", url)}
    found = [t for t in EXPECTED_TABLES if t in rows]
    return {
        "ok": True,
        "ms": int((time.monotonic() - started) * 1000),
        "rtt_ms": rtt_ms,
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

    # ---------- 유형표 ----------
    @staticmethod
    def _ensure_taxonomy(conn, grade, unit, type_, frame, description=""):
        """유형표에 (학년, 단원, 유형, 문제틀)이 없으면 추가하고 번호를 돌려준다. 문제틀이 비어 있으면 None."""
        if not frame:
            return None
        args = (grade or "", unit or "", type_ or "", frame, description or "")
        # 추가와 조회를 한 번의 요청으로 처리한다(왕복 횟수를 줄이기 위해).
        row = conn.execute(
            "with ins as (insert into taxonomy (grade, unit, type, frame, description) "
            "values (%s, %s, %s, %s, %s) on conflict (grade, unit, type, frame) do nothing returning id) "
            "select id from ins union all "
            "select id from taxonomy where grade = %s and unit = %s and type = %s and frame = %s limit 1",
            args + args[:4],
        ).fetchone()
        if row:
            return row[0]
        # 다른 요청이 같은 순간 먼저 추가한 경우: 그 요청이 끝난 뒤 다시 조회한다
        return conn.execute(
            "select id from taxonomy where grade = %s and unit = %s and type = %s and frame = %s",
            args[:4],
        ).fetchone()[0]

    def taxonomy_list(self):
        """유형표 전체 + 문제틀마다 문제 수(count), 검수 완료 수(verified), 난이도별 수."""
        with self.pool.connection() as conn:
            rows = conn.execute(
                "select t.grade, t.unit, t.type, t.frame, t.description, count(p.id), "
                "count(p.id) filter (where p.verified), "
                "count(p.id) filter (where p.difficulty = '하'), "
                "count(p.id) filter (where p.difficulty = '중'), "
                "count(p.id) filter (where p.difficulty = '상') "
                "from taxonomy t left join problems p on p.taxonomy_id = t.id "
                "group by t.id order by t.id"
            ).fetchall()
        return [
            {"grade": r[0], "unit": r[1], "type": r[2], "frame": r[3], "description": r[4],
             "count": r[5], "verified": r[6], "하": r[7], "중": r[8], "상": r[9]}
            for r in rows
        ]

    def taxonomy_upsert(self, grade, unit, type_, frame, description):
        try:
            with self.pool.connection() as conn:
                conn.execute(
                    "insert into taxonomy (grade, unit, type, frame, description) values (%s, %s, %s, %s, %s) "
                    "on conflict (grade, unit, type, frame) do update set description = excluded.description",
                    (grade or "", unit or "", type_ or "", frame or "", description or ""),
                )
            return {"ok": True}
        except Exception as e:
            return self._fail(e)

    def taxonomy_rename(self, level, old, new):
        """이름 바꾸기 / 옮기기 / 합치기. level = grade|unit|type|frame, old/new = 그 단계까지의 값.
        바꾼 이름이 이미 있으면 두 묶음이 하나로 합쳐지고(문제가 새 문제틀로 옮겨짐), 설명은 비어 있는 쪽을 채운다."""
        levels = ("grade", "unit", "type", "frame")
        if level not in levels:
            return {"ok": False, "error": "level이 올바르지 않습니다."}
        depth = levels.index(level) + 1
        old_vals = [str(old.get(lv, "")) for lv in levels[:depth]]
        new_vals = [str(new.get(lv, "")) for lv in levels[:depth]]
        try:
            with self.pool.connection() as conn:
                conn.execute("lock table taxonomy in share row exclusive mode")
                where = " and ".join(f"{lv} = %s" for lv in levels[:depth])
                rows = conn.execute(
                    f"select id, grade, unit, type, frame, description from taxonomy where {where} order by id",
                    old_vals,
                ).fetchall()
                changed = 0
                for tid, *vals, desc in rows:
                    target = list(vals)
                    target[:depth] = new_vals
                    other = conn.execute(
                        "select id, description from taxonomy where grade = %s and unit = %s and type = %s and frame = %s",
                        target,
                    ).fetchone()
                    if other and other[0] != tid:  # 이미 있는 이름 → 합치기
                        if not other[1] and desc:
                            conn.execute("update taxonomy set description = %s where id = %s", (desc, other[0]))
                        moved = conn.execute(
                            "update problems set taxonomy_id = %s where taxonomy_id = %s", (other[0], tid)
                        ).rowcount
                        conn.execute("delete from taxonomy where id = %s", (tid,))
                        changed += moved + 1
                    else:
                        conn.execute(
                            "update taxonomy set grade = %s, unit = %s, type = %s, frame = %s where id = %s",
                            (*target, tid),
                        )
                        changed += 1 + conn.execute(
                            "select count(*) from problems where taxonomy_id = %s", (tid,)
                        ).fetchone()[0]
                # 문제 쪽의 분류 글자도 유형표와 같게 맞춘다
                conn.execute(
                    "update problems p set grade = t.grade, unit = t.unit, type = t.type, frame = t.frame "
                    "from taxonomy t where p.taxonomy_id = t.id and "
                    "(p.grade, p.unit, p.type, p.frame) is distinct from (t.grade, t.unit, t.type, t.frame)"
                )
            return {"ok": True, "changed": changed}
        except Exception as e:
            return self._fail(e)

    def unit_semesters(self):
        with self.pool.connection() as conn:
            rows = conn.execute("select grade, unit, semester from units order by grade, unit").fetchall()
        return [{"grade": r[0], "unit": r[1], "semester": r[2]} for r in rows]

    def unit_semester_set(self, grade, unit, semester):
        try:
            with self.pool.connection() as conn:
                conn.execute(
                    "insert into units (grade, unit, semester) values (%s, %s, %s) "
                    "on conflict (grade, unit) do update set semester = excluded.semester, updated_at = now()",
                    (grade or "", unit or "", semester or ""),
                )
            return {"ok": True}
        except Exception as e:
            return self._fail(e)

    # ---------- 문제 은행 ----------
    _BANK_COLS = (
        "id, created_at, grade, unit, type, frame, difficulty, source, origin_id, "
        "question, answer, solution, image_ref, verified, memo"
    )
    _POSITION = {"원본": 0, "AI 기본": 1, "AI 실력": 2}

    @staticmethod
    def _bank_item(r):
        created = r[1].astimezone(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return {
            "id": r[0], "created_at": created, "grade": r[2], "unit": r[3], "type": r[4], "frame": r[5],
            "difficulty": r[6], "source": r[7], "origin_id": r[8] or "", "question": r[9], "answer": r[10],
            "solution": r[11], "image_file_id": r[12], "verified": "Y" if r[13] else "", "memo": r[14],
            "legacy_archive_id": "",
        }

    def bank_ids_for(self, group_id, count):
        return [f"{group_id}_{i + 1}" for i in range(count)]

    def bank_exists(self, group_id):
        """이 group_id로 이미 저장된 문제가 있는지 (한 번의 요청)."""
        with self.pool.connection() as conn:
            return conn.execute("select 1 from problems where id = %s", (f"{group_id}_1",)).fetchone() is not None

    def bank_save(self, group_id, problems, image_file_id=""):
        """여러 문제를 한 번에 저장한다. 같은 group_id로 다시 저장해도 중복되지 않는다(duplicate: True).
        하나라도 실패하면 아무것도 저장되지 않는다."""
        if not problems:
            return {"ok": False, "error": "저장할 문제가 없습니다."}
        ids = self.bank_ids_for(group_id, len(problems))
        try:
            with self.pool.connection() as conn:
                if conn.execute("select 1 from problems where id = %s", (ids[0],)).fetchone():
                    return {"ok": True, "ids": ids, "duplicate": True}
                first = problems[0]
                # 유형표 번호는 먼저 구해 두고(같은 분류는 한 번만), 나머지 쓰기는 한꺼번에 보낸다.
                tax_ids = {}
                for p in problems:
                    key = (p.get("grade"), p.get("unit"), p.get("type"), p.get("frame"))
                    if key not in tax_ids:
                        tax_ids[key] = self._ensure_taxonomy(conn, *key, p.get("frame_description"))
                origin_id = next((pid for pid, p in zip(ids, problems) if p.get("source") == "원본"), "")
                # 묶음과 문제 전부를 한 번의 요청으로 저장한다(왕복 횟수를 줄이기 위해, 풀러와도 호환).
                rows, params = [], [
                    group_id, first.get("grade", ""), first.get("unit", ""), first.get("frame", ""), image_file_id or ""]
                for pid, p in zip(ids, problems):
                    key = (p.get("grade"), p.get("unit"), p.get("type"), p.get("frame"))
                    rows.append("(" + ", ".join(["%s"] * 17) + ")")
                    params += [
                        pid, group_id, self._POSITION.get(p.get("source")), tax_ids[key],
                        p.get("grade", ""), p.get("unit", ""), p.get("type", ""), p.get("frame", ""),
                        p.get("difficulty", ""), p.get("source", ""),
                        None if p.get("source") == "원본" else (origin_id or None),
                        p.get("question", ""), p.get("answer", ""), p.get("solution", ""),
                        (image_file_id or "") if p.get("use_image") else "",
                        bool(p.get("verified")), p.get("memo", "")]
                conn.execute(
                    "with s as (insert into problem_sets (id, made_on, grade, unit, subtype, image_ref) "
                    "values (%s, (now() at time zone 'Asia/Seoul')::date, %s, %s, %s, %s)) "
                    "insert into problems (id, set_id, position, taxonomy_id, grade, unit, type, frame, difficulty, "
                    "source, origin_id, question, answer, solution, image_ref, verified, memo) values "
                    + ", ".join(rows),
                    params,
                )
            return {"ok": True, "ids": ids, "image_file_id": image_file_id or ""}
        except pgerrors.UniqueViolation:
            # 같은 요청이 동시에 두 번 들어온 경우: 먼저 들어온 쪽이 저장했다
            return {"ok": True, "ids": ids, "duplicate": True}
        except Exception as e:
            return self._fail(e)

    def bank_search(self, grade="", unit="", type_="", frame="", source="", difficulty=None,
                    verified=False, keyword="", ids=None, offset=0, limit=50):
        where, params = [], []
        for col, val in (("grade", grade), ("unit", unit), ("type", type_), ("frame", frame), ("source", source)):
            if val:
                where.append(f"{col} = %s")
                params.append(val)
        if difficulty:
            where.append("difficulty = any(%s)")
            params.append(list(difficulty))
        if verified:
            where.append("verified")
        if keyword:
            esc = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where.append("(question || ' ' || memo || ' ' || frame) ilike %s")
            params.append(f"%{esc}%")
        if ids:
            where.append("id = any(%s)")
            params.append([str(i) for i in ids])
        clause = (" where " + " and ".join(where)) if where else ""
        limit = max(1, min(int(limit or 50), 500))
        with self.pool.connection() as conn:
            total = conn.execute(f"select count(*) from problems{clause}", params).fetchone()[0]
            rows = conn.execute(
                f"select {self._BANK_COLS} from problems{clause} order by created_at desc, id desc offset %s limit %s",
                [*params, max(0, int(offset or 0)), limit],
            ).fetchall()
        return {"items": [self._bank_item(r) for r in rows], "total": total}

    _EDITABLE = ("grade", "unit", "type", "frame", "difficulty", "question", "answer", "solution", "verified", "memo")

    def bank_update(self, prob_id, fields):
        """한 문제의 일부 칸만 고친다. 분류를 바꾸면 유형표와도 다시 맞춘다."""
        fields = {k: v for k, v in (fields or {}).items() if k in self._EDITABLE}
        if "difficulty" in fields and fields["difficulty"] not in ("", "하", "중", "상"):
            return {"ok": False, "error": "난이도는 하, 중, 상 중 하나여야 합니다."}
        if "verified" in fields:
            fields["verified"] = str(fields["verified"]).strip().lower() in ("y", "true", "1")
        try:
            with self.pool.connection() as conn:
                row = conn.execute("select 1 from problems where id = %s for update", (prob_id,)).fetchone()
                if not row:
                    return {"ok": False, "error": "문제를 찾을 수 없습니다."}
                if fields:
                    sets = ", ".join(f"{k} = %s" for k in fields)
                    conn.execute(f"update problems set {sets} where id = %s", [*fields.values(), prob_id])
                if any(k in fields for k in ("grade", "unit", "type", "frame")):
                    g, u, t, f = conn.execute(
                        "select grade, unit, type, frame from problems where id = %s", (prob_id,)).fetchone()
                    tax_id = self._ensure_taxonomy(conn, g, u, t, f)
                    conn.execute("update problems set taxonomy_id = %s where id = %s", (tax_id, prob_id))
            return {"ok": True}
        except Exception as e:
            return self._fail(e)

    def bank_delete(self, prob_id):
        """문제를 지운다. 이미 학생에게 배정했거나 숙제에 쓴 문제는, 학생 기록이 함께 사라지지 않도록 지우지 않는다.
        지운 문제의 사진을 더 쓰는 곳이 없으면 그 사진 번호를 orphan_image 로 돌려준다."""
        try:
            with self.pool.connection() as conn:
                row = conn.execute(
                    "select image_ref, set_id from problems where id = %s for update", (prob_id,)).fetchone()
                if not row:
                    return {"ok": False, "error": "문제를 찾을 수 없습니다."}
                used = conn.execute(
                    "select exists(select 1 from assignments where problem_id = %(p)s) "
                    "or exists(select 1 from homework_problems where problem_id = %(p)s) "
                    "or exists(select 1 from hw_results where problem_id = %(p)s) "
                    "or exists(select 1 from stars where problem_id = %(p)s)", {"p": prob_id},
                ).fetchone()[0]
                if used:
                    return {"ok": False, "error": "이미 학생에게 배정했거나 숙제에 쓴 문제는 삭제할 수 없어요. (학생 기록이 함께 사라지는 것을 막기 위해서예요)"}
                image_ref, set_id = row
                conn.execute("delete from problems where id = %s", (prob_id,))
                if set_id and not conn.execute(
                        "select 1 from problems where set_id = %s limit 1", (set_id,)).fetchone():
                    conn.execute("delete from problem_sets where id = %s", (set_id,))
                orphan = ""
                if image_ref and not conn.execute(
                        "select 1 from problems where image_ref = %(i)s union all "
                        "select 1 from problem_sets where image_ref = %(i)s limit 1", {"i": image_ref}).fetchone():
                    orphan = image_ref
            return {"ok": True, "orphan_image": orphan}
        except Exception as e:
            return self._fail(e)
