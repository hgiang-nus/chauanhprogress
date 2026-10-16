#!/usr/bin/env python3
"""Build the Châu Anh progress dashboard data from the tutors' class logs.

    python3 build.py                 # uses sources.json, writes docs/data/*.json
    python3 build.py --sources other.json

Inputs (see sources.json):
  logs/Payment_<Subject>.xlsx      one per subject; only the 'Class Log' sheet is read
  logs/business_hub_index.html     the IGCSE Business course hub (optional)
  curriculum_map.json              syllabus units, keywords, indicative exam weights
  observations.json                strengths / weaknesses / improvements / gaps (hand-curated)
Outputs (docs/data): sessions, weekly, syllabus, materials, plan, observations, evaluation, meta
Payment columns are never read. Requires: openpyxl.
"""
import sys, os, re, json, argparse, datetime as dt
from html.parser import HTMLParser
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))

# Lesson titles whose keywords would mislead → unit id
OVERRIDES = {
    "SAT circular questions - Intro to Sine Cosine": "P1.5",
    "Application of Many-to-1 function and Trigonometric Equations": "P1.5",
    "Equation of Circle and Revision": "P1.3",
    "Coordinate Geometries & Equation of Linear Function": "P1.3",
    "Review session 1": "1", "Revision Midterm I": "review", "Midterm I": "assessment",
    "Review Microeconomics (part 1)": "review", "Review Microeconomics (part 2)": "review",
    "Review Midterm (part 1)": "review", "Writing Essay Correction": "skills",
}
KIND_RULES = [("assessment", r"midterm|quiz|entrance|test|kiểm tra|mock"),
              ("skills", r"essay|correction|how marks|exam technique"),
              ("review", r"review|revision|ôn")]
SPECIAL_EN = {"review": "Review", "skills": "Exam skills", "diagnostic": "Diagnostic", "assessment": "Assessment", "other": "Other"}
SPECIAL_VI = {"review": "Ôn tập", "skills": "Kỹ năng làm bài", "diagnostic": "Kiểm tra đầu vào", "assessment": "Kiểm tra", "other": "Khác"}
KIND_VI = {"teach": "Bài mới", "review": "Ôn tập", "assessment": "Kiểm tra", "skills": "Kỹ năng làm bài"}

# The academic plan agreed in June 2026 (Mentoring_Curriculum_Timeline.xlsx, sheet "Data & Econ"), extended by hand each month.
PLAN = [
    {"month": "2026-07", "subject": "maths", "planned_en": "Algebra foundations: surds, indices, quadratics, polynomials", "planned_vi": "Nền tảng đại số: căn, luỹ thừa, hàm bậc hai, đa thức"},
    {"month": "2026-08", "subject": "maths", "planned_en": "Coordinate geometry, graphs & transformations; equations, inequalities & functions", "planned_vi": "Hình học toạ độ, đồ thị & phép biến hình; phương trình, bất phương trình & hàm số"},
    {"month": "2026-09", "subject": "maths", "planned_en": "Trigonometry: identities, equations & graphs; radian measure", "planned_vi": "Lượng giác: đồng nhất thức, phương trình & đồ thị; radian"},
    {"month": "2026-10", "subject": "maths", "planned_en": "Differentiation: rules & applications", "planned_vi": "Đạo hàm: quy tắc & ứng dụng"},
    {"month": "2026-07", "subject": "econ", "planned_en": "The economic problem, scarcity & PPF; types of economy; intro to microeconomics", "planned_vi": "Vấn đề kinh tế, khan hiếm & PPF; các loại hình kinh tế; nhập môn vi mô"},
    {"month": "2026-08", "subject": "econ", "planned_en": "Demand, supply & market equilibrium; the price mechanism", "planned_vi": "Cầu, cung & cân bằng thị trường; cơ chế giá"},
    {"month": "2026-09", "subject": "econ", "planned_en": "Elasticities: PED, YED, XED, PES & applications", "planned_vi": "Độ co giãn: PED, YED, XED, PES & ứng dụng"},
    {"month": "2026-10", "subject": "econ", "planned_en": "Market failure: externalities, public & merit goods, information gaps", "planned_vi": "Thất bại thị trường: ngoại ứng, hàng hoá công & khuyến dụng, thiếu thông tin"},
    {"month": "2026-10", "subject": "business", "planned_en": "IGCSE Business 0450 revision: Units 1–5 decks, Paper 1 (6 Oct) and Paper 2 (16 Oct)", "planned_vi": "Ôn thi IGCSE Business 0450: bài giảng Unit 1–5, Paper 1 (6/10) và Paper 2 (16/10)"},
]
# Verdicts are a mentor judgement, set by hand after reading the logs: ahead | on_plan | behind | unreported
VERDICTS = {("2026-07", "maths"): "ahead", ("2026-08", "maths"): "ahead", ("2026-09", "maths"): "unreported", ("2026-10", "maths"): "unreported",
            ("2026-07", "econ"): "on_plan", ("2026-08", "econ"): "ahead", ("2026-09", "econ"): "ahead", ("2026-10", "econ"): "ahead",
            ("2026-10", "business"): "unreported"}

EVALUATION = [  # Mid-Semester Mathematics Course Evaluation, Châu Anh's responses, 26 Jul 2026
    {"item_en": "Clarity of explanations", "item_vi": "Độ rõ ràng khi giảng", "score": 5, "max": 5},
    {"item_en": "Pace of the course", "item_vi": "Nhịp độ khoá học", "score": 4, "max": 5},
    {"item_en": "Instructor's interest in learning", "item_vi": "Sự quan tâm của thầy", "score": 5, "max": 5},
    {"item_en": "Overall teaching", "item_vi": "Giảng dạy nói chung", "score": 5, "max": 5},
    {"item_en": "Overall course", "item_vi": "Khoá học nói chung", "score": 4, "max": 5},
    {"item_en": "Self-study hours per week", "item_vi": "Giờ tự học mỗi tuần", "score": 7.5, "max": None},
]


# ----------------------------------------------------------------------------- logs
def norm(s):
    return s.strip() if isinstance(s, str) else s


def parse_hours(time_str, hours_cell):
    if isinstance(hours_cell, (int, float)) and hours_cell > 0:
        return float(hours_cell)
    m = re.match(r"\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})", time_str or "")
    if m:
        h1, m1, h2, m2 = map(int, m.groups())
        return round(((h2 * 60 + m2) - (h1 * 60 + m1)) / 60, 2)
    return None


def week_start(iso):
    d = dt.date.fromisoformat(iso)
    return (d - dt.timedelta(days=d.weekday())).isoformat()


def read_log(path, subject, tutor_default):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Class Log"]
    rows = list(ws.iter_rows(values_only=True))
    header = [norm(c) for c in rows[0]]
    idx = {h: i for i, h in enumerate(header) if h}

    def col(row, *names):
        for n in names:
            if n in idx and idx[n] < len(row):
                return row[idx[n]]
        return None

    sessions, feedback = [], []
    for r in rows[1:]:
        date = col(r, "Date")
        content = norm(col(r, "Lesson content"))
        fb = norm(col(r, "Feedback"))
        if fb and len(fb) > 60:  # short strings in that column are recording names, not notes
            feedback.append({"subject": subject, "date": date.date().isoformat() if isinstance(date, dt.datetime) else None, "text": fb})
        if not isinstance(date, dt.datetime) or not content:
            continue
        time_str = norm(col(r, "Time"))
        rec = norm(col(r, "Recording link", "Link lecture notes"))
        sessions.append({
            "subject": subject, "date": date.date().isoformat(), "week": week_start(date.date().isoformat()),
            "time": time_str, "hours": parse_hours(time_str, col(r, "Number of hours")),
            "tutor": norm(col(r, "Tutor", "Tutor name")) or tutor_default, "course": norm(col(r, "Student / Class")),
            "content": content, "material": rec,
            "recording": "yes" if rec and not re.search(r"lỗi|không recording|mất pro", rec, re.I) else "no",
            "status": norm(col(r, "Status")),
        })
    return sessions, feedback


# ----------------------------------------------------------------------------- course hub (Business)
class HubParser(HTMLParser):
    """Reads the session cards of the 'Road to A*' hub: <a class="session-card" …> or <div class="session-card locked">."""
    VOID = {"br", "img", "hr", "input", "meta", "link"}

    def __init__(self):
        super().__init__()
        self.cards, self.cur, self.field, self.tag, self.depth = [], None, None, None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs); cls = a.get("class", "")
        if self.cur is None:
            if "session-card" in cls:
                self.cur = {"ready": "locked" not in cls, "href": a.get("href"), "num": "", "title": "", "blurb": ""}
                self.tag, self.depth = tag, 0
            return
        if tag in self.VOID:
            return
        self.depth += 1
        if tag == "div" and "num" in cls: self.field = "num"
        elif tag == "h3": self.field = "title"
        elif tag == "p": self.field = "blurb"

    def handle_data(self, data):
        if self.cur is not None and self.field:
            self.cur[self.field] += data

    def handle_endtag(self, tag):
        if self.cur is None or tag in self.VOID:
            return
        if self.depth == 0 and tag == self.tag:
            self.cards.append(self.cur); self.cur = None; self.field = None
        else:
            self.depth -= 1
            if tag in ("div", "h3", "p"): self.field = None


def read_hub(path, hub_map):
    p = HubParser()
    p.feed(open(path, encoding="utf-8").read())
    out = []
    for c in p.cards:
        num = re.sub(r"\s+", " ", c["num"]).strip()
        label = num.split("·")[0].strip()  # e.g. "Session 03b"
        key = next((k for k in hub_map if k != "_note" and k.strip() == label), None)
        units = hub_map.get(key, []) if key else []
        out.append({"subject": "business", "session": num, "title": re.sub(r"\s+", " ", c["title"]).strip(),
                    "blurb": re.sub(r"\s+", " ", c["blurb"]).strip(), "status": "ready" if c["ready"] else "coming_soon",
                    "units": ", ".join(u for u, _ in units), "file": c["href"] or ""})
        c["_units"] = units
    return out, p.cards


# ----------------------------------------------------------------------------- mapping
def kind_of(content):
    c = content.lower()
    for k, pat in KIND_RULES:
        if re.search(pat, c):
            return k
    return "teach"


def unit_of(content, units):
    if content.strip() in OVERRIDES:
        return OVERRIDES[content.strip()]
    c = content.lower()
    if re.search(r"syllabus|entrance quiz|quiz 60", c):
        return "diagnostic"
    hits = [u["id"] for u in units if any(k in c for k in u["keywords"])]
    return hits[0] if hits else "other"


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=os.path.join(HERE, "sources.json"))
    args = ap.parse_args()
    cfg = json.load(open(args.sources, encoding="utf-8"))
    cmap = json.load(open(os.path.join(HERE, "curriculum_map.json"), encoding="utf-8"))
    obs = json.load(open(os.path.join(HERE, "observations.json"), encoding="utf-8"))
    out_dir = os.path.join(HERE, cfg["out_dir"]); os.makedirs(out_dir, exist_ok=True)
    subjects = cfg["subjects"]

    sessions, feedback, materials, warnings = [], [], [], []
    for sub, sc in subjects.items():
        path = os.path.join(HERE, sc["log"])
        if os.path.exists(path):
            s, f = read_log(path, sub, sc["tutor"])
            sessions += s; feedback += f
            print(f"{sub}: {len(s)} sessions from {sc['log']}")
        else:
            warnings.append(f"log not found for {sub}: {sc['log']}")
        if sc.get("course_hub") and os.path.exists(os.path.join(HERE, sc["course_hub"])):
            mats, cards = read_hub(os.path.join(HERE, sc["course_hub"]), cmap[sub].get("hub_unit_map", {}))
            for m in mats:
                if m["file"] and not m["file"].startswith("http"):
                    m["file"] = sc.get("course_hub_base", "") + m["file"]
            materials += mats
            # decks that are ready mark their subtopics as 'prepared'
            prepared = {u["id"]: [False] * len(u["subtopics_en"]) for u in cmap[sub]["units"]}
            for c in cards:
                if c["ready"]:
                    for uid, ids in c["_units"]:
                        for i in ids:
                            prepared[uid][i] = True
            cmap[sub]["_prepared"] = prepared
            print(f"{sub}: {len(mats)} course decks from {sc['course_hub']} ({sum(m['status'] == 'ready' for m in mats)} ready)")
    for w in warnings:
        print("WARNING:", w)
    sessions.sort(key=lambda s: (s["date"], s["subject"]))

    unit_index = {sub: {u["id"]: u for u in cmap[sub]["units"]} for sub in subjects}
    for s in sessions:
        uid = unit_of(s["content"], cmap[s["subject"]]["units"])
        u = unit_index[s["subject"]].get(uid)
        s["unit"] = uid
        s["unit_en"] = u["name_en"] if u else SPECIAL_EN.get(uid, uid)
        s["unit_vi"] = u["name_vi"] if u else SPECIAL_VI.get(uid, uid)
        s["kind"] = kind_of(s["content"]); s["kind_vi"] = KIND_VI[s["kind"]]
        if uid == "other":
            warnings.append(f"unmapped lesson title ({s['subject']}, {s['date']}): {s['content']}")

    # weekly
    weekly = {}
    for s in sessions:
        w = weekly.setdefault((s["week"], s["subject"]), {"week": s["week"], "subject": s["subject"], "sessions": 0, "hours": 0.0, "topics": [], "units": []})
        w["sessions"] += 1; w["hours"] = round(w["hours"] + (s["hours"] or 0), 2); w["topics"].append(s["content"])
        if s["unit_en"] not in w["units"]:
            w["units"].append(s["unit_en"])
    if sessions:
        d, last = dt.date.fromisoformat(min(s["week"] for s in sessions)), dt.date.fromisoformat(max(s["week"] for s in sessions))
        while d <= last:
            for sub in subjects:
                weekly.setdefault((d.isoformat(), sub), {"week": d.isoformat(), "subject": sub, "sessions": 0, "hours": 0.0, "topics": [], "units": []})
            d += dt.timedelta(days=7)
    weekly_rows = [{**w, "topics": " · ".join(w["topics"]), "units": " · ".join(w["units"])} for w in sorted(weekly.values(), key=lambda w: (w["week"], w["subject"]))]

    # syllabus coverage
    syllabus = []
    for sub, sc in subjects.items():
        cm = cmap[sub]
        for u in cm["units"]:
            ss = [s for s in sessions if s["subject"] == sub and s["unit"] == u["id"]]
            if "subtopics_covered" in cm:
                cov = cm["subtopics_covered"][u["id"]]; n_tot, n_cov = len(cov), sum(cov)
            else:
                n_tot, n_cov = 1, (1 if ss else 0)
            n_prep = sum(cm.get("_prepared", {}).get(u["id"], [])) if cm.get("_prepared") else 0
            status = "covered" if n_cov == n_tot else ("partial" if n_cov else ("prepared" if n_prep else "not_yet"))
            syllabus.append({"exam": sc["exam"], "subject": sub, "unit": u["id"], "name_en": u["name_en"], "name_vi": u["name_vi"], "weight": u["weight"],
                             "status": status, "subtopics": n_tot, "subtopics_covered": n_cov, "subtopics_prepared": n_prep,
                             "coverage": round(n_cov / n_tot, 3), "prepared": round(n_prep / n_tot, 3) if cm.get("_prepared") else None,
                             "sessions": len(ss), "first_date": min((s["date"] for s in ss), default=None), "last_date": max((s["date"] for s in ss), default=None),
                             "subtopic_list": " · ".join(u.get("subtopics_en", []))})
    # SAT domains from the Maths units
    unit_status = {r["unit"]: r["status"] for r in syllabus if r["exam"] == "maths_p1"}
    for dmn in cmap["maths"]["sat"]["domains"]:
        feeds = dmn["feeds_from"]; done = [f for f in feeds if unit_status.get(f) == "covered"]
        partial_only = dmn["name_en"] in ("Algebra", "Geometry & Trigonometry")  # SAT also tests content outside Pure 1
        if not feeds:
            status, cov = "not_yet", 0.0
        elif len(done) == len(feeds):
            status, cov = ("partial", 0.6) if partial_only else ("covered", 1.0)
        else:
            status, cov = "partial", round(len(done) / len(feeds) * 0.6, 2)
        syllabus.append({"exam": "sat_math", "subject": "maths", "unit": dmn["name_en"], "name_en": dmn["name_en"], "name_vi": dmn["name_vi"], "weight": dmn["weight"],
                         "status": status, "subtopics": len(feeds) or 1, "subtopics_covered": len(done), "subtopics_prepared": 0, "coverage": cov, "prepared": None,
                         "sessions": sum(1 for s in sessions if s["subject"] == "maths" and s["unit"] in feeds), "first_date": None, "last_date": None,
                         "subtopic_list": dmn["detail_en"] + " || " + dmn["detail_vi"]})

    # plan vs actual
    plan = []
    for p in PLAN:
        p = dict(p)
        ss = [s for s in sessions if s["subject"] == p["subject"] and s["date"].startswith(p["month"])]
        p["sessions"] = len(ss); p["hours"] = round(sum(s["hours"] or 0 for s in ss), 1)
        skip = ("review", "skills", "diagnostic", "assessment", "other")
        en, vi = [], []
        for s in ss:
            if s["unit"] not in skip:
                if s["unit_en"] not in en: en.append(s["unit_en"])
                if s["unit_vi"] not in vi: vi.append(s["unit_vi"])
        p["actual_en"] = " · ".join(en) if en else ("No sessions logged" if not ss else "Review / assessment only")
        p["actual_vi"] = " · ".join(vi) if vi else ("Chưa có buổi nào được ghi" if not ss else "Chỉ ôn tập / kiểm tra")
        p["verdict"] = VERDICTS.get((p["month"], p["subject"]), "unreported")
        plan.append(p)

    meta = {"generated": dt.datetime.now().astimezone().isoformat(timespec="minutes"), "student": cfg["student"],
            "subjects": {sub: {"label_en": sc["label_en"], "label_vi": sc["label_vi"], "tutor": sc["tutor"], "exam": sc["exam"], "log": os.path.basename(sc["log"]),
                               "log_found": os.path.exists(os.path.join(HERE, sc["log"]))} for sub, sc in subjects.items()},
            "warnings": warnings}

    for name, rows in (("sessions", sessions), ("weekly", weekly_rows), ("syllabus", syllabus), ("materials", materials),
                       ("observations", obs), ("plan", plan), ("evaluation", EVALUATION), ("meta", meta)):
        with open(os.path.join(out_dir, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=0)
    with open(os.path.join(out_dir, "feedback_notes.json"), "w", encoding="utf-8") as f:
        json.dump(feedback, f, ensure_ascii=False, indent=0)  # raw tutor notes, for maintaining observations.json
    print(f"wrote {out_dir}: {len(sessions)} sessions, {len(weekly_rows)} weekly rows, {len(syllabus)} syllabus rows, {len(materials)} materials")
    for w in warnings:
        print("WARNING:", w)


if __name__ == "__main__":
    main()
