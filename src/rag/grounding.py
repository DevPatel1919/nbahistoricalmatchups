"""
grounding.py

The grounding check for Ask the Court (F13 Session 4). Prompts alone don't
stop a model adding a number, so every number in an answer must be found in
a fact or chunk that its sentence cites:

    1. extract every number: records (72–10), seasons (1995–96, '96), years,
       percentages (57.4%), fractions (.574), signed values (+13.3), ordinals
       (19th) and spelled-out numbers from three to twenty;
    2. each must match a number in a source the same sentence cites, after
       normalisation: the source rounded to the answer's precision ("about 7
       points" matches 6.9), % <-> fraction (57.4% matches .574), seasons <->
       years (1995–96 matches the key 1996-bulls), and sign ignored;
    3. every citation label must exist, and a sentence with a number must cite.

Exempt: decades ("the 1990s"), stat names ("three-point %"), the unit numbers in "per 100 possessions" and
"per 48 minutes", "one" and "two" spelled out ("the two teams"), and any
number the question itself contains.

Sources are read with the same rules, so numbers written by src/rag/textfmt.py
(en-dash records and seasons, .878, +13.3, 61.8%) always match themselves.
The Worker's grounding.ts (Session 5) must pass the same unit tests.
"""

import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from src.rag import textfmt as fmt

CITATION     = re.compile(r"\[((?:[FC]\d+)(?:\s*[,;]\s*[FC]?\d+)*)\]")
LABEL        = re.compile(r"([FC]?)(\d+)")
LEADING_CITE = re.compile(r"^((?:\s*\[(?:[FC]\d+)(?:\s*[,;]\s*[FC]?\d+)*\])+)\s*")

UNIT_NUMBERS = {Decimal(100), Decimal(48)}
# Stat names with a number in them: "three-point %" states no number.
STAT_NAMES   = re.compile(r"(?<![\w.])(?:three|3|two|2)[- ]point(?:ers?)?\b", re.IGNORECASE)
SPELLED = {"three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
           "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
           "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20}

# Applied in order; each claims its span so later patterns can't re-read it.
PATTERNS = [
    ("decade",  re.compile(r"(?<![\w.])'?(\d{4}|\d0)'?s\b")),
    ("season",  re.compile(r"(?<![\w.])(\d{4})\s*-\s*(\d{4}|\d{2})(?!\d)")),
    ("short",   re.compile(r"(?<![\w.])'(\d{2})(?![\d%])")),
    ("record",  re.compile(r"(?<![\w.])(\d{1,3})\s*-\s*(\d{1,3})(?!\d|\.\d|%)")),
    ("percent", re.compile(r"(?<![\w.])[+-]?(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)")),
    ("number",  re.compile(r"(?<![\w.])[+-]?(\d+(?:\.\d+)?|\.\d+)(?:st|nd|rd|th)?(?![\w])")),
    ("spelled", re.compile(r"\b(" + "|".join(SPELLED) + r")\b")),
]


@dataclass(frozen=True)
class Num:
    kind: str        # decade | season | record | percent | fraction | year | number
    value: object    # Decimal, (wins, losses) for a record, int end year for a season
    places: int      # decimal places shown
    raw: str


def normalize(text: str) -> str:
    text = text.replace("−", "-").replace(fmt.DASH, "-").replace("—", "-")
    text = text.replace("’", "'").replace("‘", "'")
    return text.replace(" ", " ").replace(" ", " ")


def places(digits: str) -> int:
    return len(digits.split(".", 1)[1]) if "." in digits else 0


def rounded(value: Decimal, digits: int) -> Decimal:
    return value.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)


def extract(text: str) -> list[Num]:
    """Every number in text, citation labels excluded."""
    blank = lambda m: " " * len(m.group(0))
    text = STAT_NAMES.sub(blank, CITATION.sub(blank, normalize(text)))
    taken = [False] * len(text)
    found = []
    for kind, pattern in PATTERNS:
        for m in pattern.finditer(text if kind != "spelled" else text.lower()):
            if any(taken[m.start():m.end()]):
                continue
            num = None
            if kind == "decade":
                num = Num("decade", m.group(1), 0, m.group(0))
            elif kind == "season":
                first, second = int(m.group(1)), int(m.group(2))
                if second in (first + 1, (first + 1) % 100):
                    num = Num("season", first + 1, 0, m.group(0))
            elif kind == "short":
                yy = int(m.group(1))
                num = Num("season", 1900 + yy if yy >= 46 else 2000 + yy, 0, m.group(0))
            elif kind == "record":
                num = Num("record", (int(m.group(1)), int(m.group(2))), 0, m.group(0))
            elif kind == "percent":
                num = Num("percent", Decimal(m.group(1)), places(m.group(1)), m.group(0))
            elif kind == "number":
                digits = m.group(1)
                value = Decimal(digits)
                if digits.startswith(".") or digits.startswith("0."):
                    num = Num("fraction", value, places(digits), m.group(0))
                elif "." not in digits and 1946 <= value <= 2035:
                    num = Num("year", int(value), 0, m.group(0))
                else:
                    num = Num("number", value, places(digits), m.group(0))
            elif kind == "spelled":
                num = Num("number", Decimal(SPELLED[m.group(1)]), 0, m.group(0))
            if num is not None:
                found.append((m.start(), num))
                for i in range(m.start(), m.end()):
                    taken[i] = True
    return [n for _, n in sorted(found, key=lambda x: x[0])]


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

@dataclass
class Pool:
    """The numbers a set of sources supports, in every form they can be written."""
    records: set = field(default_factory=set)
    seasons: set = field(default_factory=set)      # end years
    years: set = field(default_factory=set)
    percents: list = field(default_factory=list)
    fractions: list = field(default_factory=list)
    values: list = field(default_factory=list)     # every plain magnitude

    @classmethod
    def of(cls, texts: list[str]) -> "Pool":
        pool = cls()
        for text in texts:
            for n in extract(text):
                pool.add(n)
        return pool

    def add(self, n: Num) -> None:
        if n.kind == "record":
            self.records.add(n.value)
            self.values += [Decimal(n.value[0]), Decimal(n.value[1])]
        elif n.kind == "season":
            self.seasons.add(n.value)
            self.years |= {n.value, n.value - 1}
        elif n.kind == "year":
            self.years.add(n.value)
            self.seasons.add(n.value)
            self.values.append(Decimal(n.value))
        elif n.kind == "percent":
            self.percents.append(n.value)
            self.fractions.append(n.value / 100)
            self.values.append(n.value)
        elif n.kind == "fraction":
            self.fractions.append(n.value)
            self.percents.append(n.value * 100)
            self.values.append(n.value)
        elif n.kind == "number":
            self.values.append(abs(n.value))
            if n.value <= 1:                       # "1.000" is a fraction too
                self.fractions.append(abs(n.value))
                self.percents.append(abs(n.value) * 100)

    def supports(self, n: Num) -> bool:
        if n.kind == "decade":
            return True
        if n.kind == "record":
            return n.value in self.records
        if n.kind == "season":
            return n.value in self.seasons or n.value in self.years
        if n.kind == "year":
            return n.value in self.years or n.value + 1 in self.seasons
        if n.kind == "percent":
            return any(rounded(p, n.places) == abs(n.value) for p in self.percents)
        if n.kind == "fraction":
            return any(rounded(f, n.places) == n.value for f in self.fractions)
        return any(rounded(abs(v), n.places) == abs(n.value) for v in self.values)


def exempt(n: Num, question_pool: Pool) -> bool:
    if n.kind == "decade":
        return True
    if n.kind == "number" and n.places == 0 and n.value in UNIT_NUMBERS:
        return True
    return question_pool.supports(n)


# ---------------------------------------------------------------------------
# Sentences and the check
# ---------------------------------------------------------------------------

def labels_in(text: str) -> list[str]:
    """'[F1] ... [F2, C3]' -> ['F1', 'F2', 'C3']. A bare number after a comma keeps the letter before it."""
    out = []
    for group in CITATION.findall(text):
        letter = "F"
        for prefix, digits in LABEL.findall(group):
            letter = prefix or letter
            label = letter + digits
            if label not in out:
                out.append(label)
    return out


def sentences(answer: str) -> list[str]:
    """
    Split into sentences and lines. A citation that opens a sentence ("...
    in 1995–96. [F1] The Bulls...") belongs to the sentence before it.
    """
    out = []
    for line in answer.split("\n"):
        for part in re.split(r"(?<=[.!?])\s+", line.strip()):
            if not part:
                continue
            m = LEADING_CITE.match(part)
            if m and out:
                out[-1] = out[-1] + " " + m.group(1).strip()
                part = part[m.end():]
            if part.strip():
                out.append(part.strip())
    return out


@dataclass
class Report:
    ok: bool
    problems: list            # (sentence index, sentence, message, kind: label | uncited | unsupported)
    sentences: list
    citations: list           # labels cited anywhere, in order
    numbers: int              # numbers checked (not exempt)

    def bad_sentences(self) -> set:
        return {i for i, _, _, _ in self.problems}


def check(answer: str, sources: dict, question: str = "") -> Report:
    """sources: {label: text}, e.g. {"F1": "...", "C1": "title\\ntext"}."""
    pools = {}
    question_pool = Pool.of([question])
    parts = sentences(answer)
    problems, cited, checked = [], [], 0
    for i, sentence in enumerate(parts):
        labels = labels_in(sentence)
        cited += [lab for lab in labels if lab not in cited]
        for lab in labels:
            if lab not in sources:
                problems.append((i, sentence, "cites [" + lab + "], which doesn't exist", "label"))
        claims = [n for n in extract(sentence) if not exempt(n, question_pool)]
        checked += len(claims)
        known = [lab for lab in labels if lab in sources]
        if claims and not known:
            problems.append((i, sentence, "has numbers (" + ", ".join(n.raw.strip() for n in claims) + ") but cites no source",
                             "uncited"))
            continue
        for lab in known:
            if lab not in pools:
                pools[lab] = Pool.of([sources[lab]])
        for n in claims:
            if not any(pools[lab].supports(n) for lab in known):
                problems.append((i, sentence, "says " + n.raw.strip() + ", which isn't in " + ", ".join(
                    "[" + lab + "]" for lab in known), "unsupported"))
    return Report(ok=not problems, problems=problems, sentences=parts, citations=cited, numbers=checked)


def drop_labels(sentence: str, known: set) -> str:
    """Remove citation labels that aren't in known: '[C2, F1]' -> '[C2]'."""
    def keep(m):
        labels = [lab for lab in labels_in(m.group(0)) if lab in known]
        return "[" + ", ".join(labels) + "]" if labels else ""
    return re.sub(r"\s+([.!?])", r"\1", CITATION.sub(keep, sentence)).strip()


def strip_unsupported(report: Report, sources: dict) -> tuple[str, int]:
    """
    The answer without the sentences that failed, and how many were removed.
    A sentence whose only fault is a label that doesn't exist keeps its text
    and loses the label: its numbers are supported by the labels it has left.
    """
    kinds = {}
    for i, _, _, kind in report.problems:
        kinds.setdefault(i, set()).add(kind)
    kept, removed = [], 0
    for i, sentence in enumerate(report.sentences):
        if i not in kinds:
            kept.append(sentence)
        elif kinds[i] == {"label"}:
            kept.append(drop_labels(sentence, set(sources)))
        else:
            removed += 1
    return " ".join(kept), removed


def feedback(report: Report) -> str:
    """The failures, listed for the regeneration prompt."""
    return "\n".join("- Sentence \"" + s + "\" " + msg + "." for _, s, msg, _ in report.problems)
