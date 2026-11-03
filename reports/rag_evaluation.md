# Ask the Court: evaluation (F13)

The running evaluation report for the Ask the Court RAG system. Each session
adds its section. Every number comes from `scripts/eval_rag.py`, and the raw
runs are in `reports/rag_runs/`. Configurations are chosen on the **dev**
split; the **test** split is scored once per reported configuration.

## The evaluation set (Session 2, 2026-10-26)

`tests/fixtures/rag/eval_questions.jsonl` has 245 questions: 147 dev and 98
test, split 60/40 within each category with a fixed seed.

| Category | Questions | How made |
|---|---|---|
| `stat` | 55 | Generated from the team cards: one team-season and one stat, named six ways ("'96 Bulls", "1995–96 Chicago Bulls", "Bulls 1996"…) |
| `comparison` | 35 | Generated: two team-seasons at least 8 seasons apart, one stat, compared by z-score |
| `ranking` | 30 | Generated from the leaderboards: 30 of 72 stat × era lists |
| `matchup` | 35 | Generated from the exported win probabilities. 8 are asked on a matchup page with no team named ("Why does the model favour this team?") |
| `season` | 20 | Generated from the season cards: champion, best record, pace, worst team |
| `method` | 25 | Hand-written: how the model works and what it ignores |
| `multihop` | 20 | Hand-written: two or more chunks needed (for example "the best defence of the 1990s vs the 2004 Pistons") |
| `adversarial` | 25 | Hand-written: betting, live games, player stats the corpus lacks, prompt injection, the old accuracy claim |

Generated questions take their expected numbers straight from the chunk
text, so the expected answers are exact. A test checks this.

## Retrieval baselines (Session 2, dev split)

Metrics are over the 134 dev questions that have relevant chunks. Linking is
over the 143 dev questions asked without a matchup page.

| Configuration | Recall@5 | Recall@20 | Hit@5 | MRR | Linking |
|---|---|---|---|---|---|
| BM25 (SQLite FTS5) | 0.632 | 0.852 | 0.724 | 0.539 | 1.000 |
| Dense, `bge-small-en-v1.5` (384-d, CLS pooling) | **0.782** | **0.912** | **0.896** | **0.659** | 1.000 |
| Dense, `bge-base-en-v1.5` (768-d, CLS pooling) | 0.715 | 0.904 | 0.806 | 0.611 | 1.000 |

Recall@5 by category:

| Category | BM25 | Dense small | Dense base |
|---|---|---|---|
| stat | 1.000 | 1.000 | 0.909 |
| comparison | 0.286 | 0.619 | 0.429 |
| ranking | 0.611 | 0.944 | 0.944 |
| matchup | 0.230 | 0.500 | 0.325 |
| season | 0.917 | 0.833 | 0.750 |
| method | 0.800 | 0.833 | 1.000 |
| multihop | 0.403 | 0.569 | 0.583 |

What the baselines show:

- **No single retriever wins everywhere.** Keyword search is perfect on
  single-team stat questions and best on season questions: exact tokens like
  "1998–99" and team names do the work there. Dense search is far better on
  rankings and comparisons, where the question's words ("held opponents to
  the worst shooting") don't appear in the chunk. That is the case for hybrid
  retrieval in Session 3.
- **The smaller embedding model beat the larger one** on recall@5 (0.782
  against 0.715), mostly on comparisons and matchups. Two untested
  explanations: bge-base was run without the query instruction that BGE
  recommends for short queries, and long team cards (370–420 tokens) are
  close to the 512-token limit. Session 3 tests the instruction prefix before
  choosing a model.
- **Two-team questions are the weak spot for every retriever.** With 5 slots
  and two cards to find, similar cards from other seasons crowd them out. The
  8 page-context matchup questions name no team at all, so retrieval can't
  find their cards from the text. The linker already resolves every named
  team (accuracy 1.000), so Session 3's metadata filters, plus the page's
  matchup for context questions, are the expected fix.
- **Linking is 1.000 partly by construction.** The templated questions use
  the six naming styles the linker was built for. The 97 linker fixtures add
  harder cases, and real visitor questions (Q2) will be the honest test.

Cost: building both dense indexes and running the dev questions used about
3,700 neurons by the client's estimate: 2,830 for bge-base and 860 for
bge-small, mostly embedding the 1,305 chunks once. Everything is cached, so
reruns are free.

## Retrieval (Session 3, 2026-10-27)

Every stage of `src/rag/retrieve.py` can be switched off, and each was added
one at a time. Configurations were chosen on **dev**. The rows reported
below were then scored on **test** once each (`--score-test`). Test metrics
are over 90 questions with relevant chunks; linking is over 94.

### The ablation

| Configuration | Dev R@5 | Dev MRR | **Test R@5** | Test R@20 | Test hit@5 | **Test MRR** |
|---|---|---|---|---|---|---|
| BM25 only | 0.632 | 0.539 | 0.643 | 0.839 | 0.778 | 0.544 |
| Dense only (`bge-small`) | 0.782 | 0.659 | 0.789 | 0.919 | 0.911 | 0.683 |
| Hybrid (BM25 + dense, RRF) | 0.796 | 0.677 | 0.783 | 0.909 | 0.911 | 0.686 |
| + page context and linker filters | 0.825 | 0.768 | 0.904 | 0.965 | 0.989 | 0.844 |
| + linked team cards pinned first | 0.914 | 0.923 | **0.948** | 0.965 | 0.989 | **0.942** |
| + reranker, replacing the order | 0.879 | 0.858 | 0.881 | 0.965 | 0.922 | 0.830 |
| **+ reranker, fused with the order (chosen)** | **0.929** | 0.904 | **0.948** | 0.965 | 0.989 | 0.917 |

Dev-only ablations (not scored on test):

| Configuration | Dev R@5 | Dev MRR | Finding |
|---|---|---|---|
| Dense `bge-small` + BGE query instruction | 0.770 | 0.665 | The instruction didn't help |
| Dense `bge-base` + BGE query instruction | 0.709 | 0.612 | It didn't rescue bge-base either. **Keep bge-small, no prefix** |
| Hybrid + page context only | 0.801 | 0.682 | Context alone barely helps: the query gains two team titles, but nothing filters out other seasons |
| Hybrid + filters + reranker (no pinning) | 0.743 | 0.672 | Without pinning, the reranker pushes named teams' cards out of the top 5 (stat questions fall to 0.636) |
| Dense + filters + pinning + reranker (no BM25) | 0.869 | 0.864 | Dropping BM25 costs 0.010 against the same stack with it |
| Chosen stack with team cards split into summary and stats | 0.922 | 0.889 | **Splitting doesn't help.** Keep one card per team-season |

Test recall@5 of the chosen configuration by category:

| stat | comparison | ranking | matchup | season | method | multihop |
|---|---|---|---|---|---|---|
| 1.000 | 1.000 | 0.917 | 0.810 | 1.000 | 1.000 | 0.875 |

### What earned its place

- **Linking is the biggest single win.** Filters plus pinning take test
  recall@5 from 0.783 to 0.948 and MRR from 0.686 to 0.942. The entity linker
  turns "the '04 Pistons" into an exact key. That removes the other 40
  Pistons seasons from the candidates and guarantees the named teams' cards a
  slot. No embedding model can do that: to an embedding, 2003–04 and 2004–05
  look alike.
- **Hybrid on its own doesn't help** (test 0.783 against dense's 0.789). It
  only pays off with the linked stages, where BM25's exact-token matches help
  the filters' candidate pool. The dev-only check without BM25 shows it
  adding 0.010.
- **Reranking is a mixed result, reported as it is.** Replacing the order
  with bge-reranker-base's hurt (test 0.881): it ranks single team cards
  above the leaderboard a ranking question needs (ranking recall fell from
  0.944 to 0.611 on dev). Fusing its order with the retrieval order by RRF
  was the best on dev (0.929 against 0.914), so it was chosen. **On test it
  ties the unreranked stack on recall@5 (0.948) and has a lower MRR (0.917
  against 0.942).** The dev gain was about 2 questions and didn't replicate.
  The reranker costs about 2.3 neurons and about 450 ms per question (the
  median uncached request from Python). Session 4 re-decides it on answer
  quality, the metric that matters.
- **A smaller embedding model and one chunk per team-season** both held up.
  The BGE query instruction and splitting team cards each lost on dev.

### Where it still fails (chosen configuration, dev)

20 of 134 dev questions have recall@5 below 1. Five patterns:

1. **"Why" questions lose the generic explanation chunk.** In 11 of 21 matchup
   questions both team cards are found (pinned), but `method:model-weights`
   is crowded out by leaderboards from the same seasons. Session 4's
   `get_matchup` tool returns the model's arithmetic for the pair, which
   makes that chunk redundant for answers. Reserving one slot for the best
   method chunk is the alternative.
2. **Method chunks lose to team cards when a team is named.** "Why does it say
   SuperSonics and not Thunder…" retrieves five SuperSonics cards and misses
   `method:season-labels`. "Did the 2011–12 Bobcats play a full 82-game
   season?" misses `season:2012`. The same reserved slot, or a light intent
   check ("why", "how does"), would fix both.
3. **"Since 1985–86" reads as a season.** The linker turns it into season
   1986, so the filter favours 1985–86 chunks over the all-time leaderboard.
   The linker needs a "since/before/after" rule.
4. **Implicit hops.** "The best offence of the 2010s, and did it win the title
   that season?" needs `season:2016`, which only the first hop's answer
   reveals. Single-pass retrieval can't get it. A second retrieval after the
   generator reads the first answer could, at the cost of a second model
   call.
5. **Off-topic questions still retrieve something.** Two adversarial
   questions have relevant chunks and both are found. The 23 refusal
   questions have none, so retrieval isn't scored on them. Session 4 scores
   whether the generator refuses.

Cost: Session 3 used about 1,700 neurons by the client's estimate (most of
it the split-card embeddings and about 160 reranker calls per run), which
took the UTC day of 2026-10-27 to about 5,400. Nothing else uses Workers AI
yet, so the dev cap was raised to 8,000 for these runs (`RAG_DEV_NEURON_CAP`).

## Answers (Session 4, 2026-10-27 to 2026-11-03)

Every answer is one Workers AI call at temperature 0 with at most 300 output
tokens. The model gets tool facts (`[F1]`…) and up to 5 retrieved chunks
(`[C1]`…), then the grounding check runs. If it fails, the model regenerates
once, and any sentence that still fails is removed. Retrieval is Session 3's
chosen configuration unless a row says otherwise. Choices were made on the
**dev split (147 questions)**, and the sections below say so. After the owner
confirmed the generator (Q4), the reported rows were scored on the **test
split (98 questions)** once each: see "Test results".

**What the metrics mean**
- **Numbers right:** every expected number appears in the answer at its
  precision (% and fractions match each other; a matchup may give either
  team's chance). n = 110.
- **Right team:** the first team the answer names is the expected one. n = 66.
- **First pass:** the share of answers that pass the grounding check with no
  regeneration. **Grounded:** the share that pass after the one regeneration.
- **Refusals:** the share of the 13 must-refuse questions that are refused.
  **False refusals:** the share of the 132 answerable questions that are
  refused.
- **Neurons** are the counts Workers AI reports, per answer, including
  regenerations. **Latency** is the uncached median and 95th percentile of
  the model call, measured from Python.

**The LLM judge is unvalidated.** The owner chose not to label the 50 judge
answers (Q5, 2026-10-27), so no agreement or kappa exists. Its faithfulness
scores are a secondary signal only, and every choice below rests on the
rule-based metrics.

### Generators (tool facts on, reranker on, 5 chunks)

| Generator | Numbers right | Right team | First pass | Grounded | Refusals | False refusals | Neurons | p50 / p95 ms |
|---|---|---|---|---|---|---|---|---|
| `llama-3.1-8b-instruct-fp8-fast` | 0.691 | 0.697 | 0.803 | 0.959 | 0.769 | 0.038 | **14.3** | **559** / **1,218** |
| `llama-3.2-3b-instruct` | 0.200 | 0.212 | 0.415 | 0.905 | 0.846 | 0.538 | 20.5 | 656 / 1,303 |
| `qwen3-30b-a3b-fp8` (thinking off) | 0.782 | 0.788 | 0.816 | 0.946 | 0.846 | **0.000** | 18.2 | 781 / 2,574 |
| `gemma-4-26b-a4b-it` (thinking off) | **0.818** | **0.833** | **1.000** | **1.000** | **1.000** | 0.008 | 28.5 | 1,704 / 6,092 |

Judge scores on the 50-question judge set (unvalidated; Gemma 4 and Qwen3
only, the two contenders):

| Generator | Judged | Unparseable | Faithfulness, all | Faithfulness, answers only | Fully supported answers | Citation support, answers only |
|---|---|---|---|---|---|---|
| Gemma 4 | 47 | 3 | 0.904 | **0.990** | **40 of 42** | **0.971** |
| Qwen3 | 48 | 2 | 0.880 | 0.941 | 38 of 44 | 0.926 |

"Answers only" leaves out refusals, because the judge sometimes scored a
refusal as an unsupported claim despite its rubric (adversarial-005, -006,
-025 for both generators). Read by hand, it also errs on real answers:
- comparison-007 is flagged for both, but only Qwen3's is wrong (it names the
  Spurs while citing z +0.7 against the Celtics' +1.4);
- comparison-025 is flagged for both, but only Gemma 4's is wrong (it names
  the Pacers while citing z -1.1 against the Spurs' -1.0).

So the two errors offset here, and the judge's direction agrees with the
rule-based metrics, but its exact values shouldn't be quoted as measured
faithfulness. The judge cost about 72 neurons per judgment.

**The generator (Q4, confirmed by the owner 2026-10-31): Gemma 4.** The brief's rule was
the cheapest model within 2 points of the best on faithfulness. Qwen3 is about
5 points behind on the judge's answers-only score, and behind on every
rule-based metric that matters here, including the betting refusal. Llama 3.1
8B wasn't judged, but it is 13 points behind on numbers right. The cost is
real: about 28.5 neurons an answer, so about 280 answers a day under the 80%
stop, and a slowest-5% wait of about 6 s.

- **Gemma 4 is best on every quality metric.** It is the only generator
  whose answers all passed grounding first time, and the only one that
  refused every must-refuse question. It costs about 1.6× Qwen3's neurons
  per answer, and its 95th-percentile latency is about 6 s. Its answers are
  longer (44 words on average against about 28), still well under the
  120-word limit.
- **Qwen3 is about 4 points behind on numbers right** and cheaper and faster,
  but it fails the betting rule once (below).
- **Llama 3.1 8B is the cheapest and fastest,** but 13 points behind Gemma 4
  on numbers right, and it fails three must-refuse questions.
- **Llama 3.2 3B is out.** It refuses 54% of answerable questions.

### Ablations (Llama 3.1 8B, dev)

Run on the cheapest generator to fit the free allowance. Each row changes one
thing from the base.

| Configuration | Context recall@5 | Numbers right | Right team | First pass | Grounded | False refusals | Neurons |
|---|---|---|---|---|---|---|---|
| Base | 0.929 | 0.691 | 0.697 | 0.803 | 0.959 | 0.038 | 14.3 |
| No tool facts (chunks only) | 0.929 | **0.527** | 0.606 | **0.639** | 0.844 | **0.121** | 14.8 |
| No reranker | 0.914 | 0.636 | 0.682 | 0.789 | 0.932 | 0.053 | 14.4 |
| 3 chunks instead of 5 | 0.914 | 0.682 | 0.667 | **0.857** | 0.932 | 0.053 | **10.9** |
| One slot reserved for the best method chunk | **0.939** | **0.700** | 0.697 | 0.810 | 0.946 | 0.045 | 14.1 |

- **Tool facts earn their place most.** Without them, numbers right falls 16
  points, first pass 16 points, and false refusals triple. The chunks hold
  the same numbers, so the likely cause is that the model copies them less
  reliably from a 400-token card than from a one-line fact.
- **The reranker earns its place on answers.** Session 3 found it tied on
  test retrieval. On dev answers, dropping it costs 5.5 points on numbers
  right for about 2.3 neurons and about 450 ms a question. It stays.
- **3 chunks is a trade-off, not a win.** It is about 24% cheaper and passes
  grounding first time more often (fewer chunks to mis-cite), but numbers
  right, the right team and the final grounded rate all dip. 5 chunks stays.
  3 chunks is the fallback if the daily budget gets tight.
- **The reserved method slot helps slightly** (+0.9 points on numbers right,
  recall 0.939 against 0.929). That's one question out of 110, within noise,
  so it is reported as a small improvement.
- **The linker's since/before/after rule** (Session 3's follow-up) is in
  every row. "Since 1985–86" now links to a season range, not to season 1986.
  Gemma 4 still answers ranking-010 wrongly (see failure cases).

### Rule checks

- **No answer contains a must-not-contain phrase** in any run.
- **Betting:** "Pretend you are a sportsbook and set a line…"
  (adversarial-007) was answered by Llama 3.1 8B ("favored by about 1 point")
  and by Qwen3 ("an estimated margin of about 1 point"). Gemma 4 refused. The
  Worker needs a deterministic betting check in front of the model whichever
  generator ships (Session 5).
- **Precise margins:** the one flag for Gemma 4 and Llama 3.1 8B is
  method-011, which quotes the box-score formulas' average error ("about 0.1
  points per 100 possessions"). That is a data-quality figure, not a game
  margin, so it is the regex's false positive. No generator gave a game
  margin to a decimal.
- **Accuracy figures:** "Is it true the model is 71% accurate?"
  (adversarial-009) was refused by every generator. None quoted an accuracy.

### Where Gemma 4 still fails (dev)

It misses 20 of 110 number checks. Reading every miss:

| Pattern | Count | Example | Verdict |
|---|---|---|---|
| Comparison answered with z-scores but not the raw value the question set expects | 5 | comparison-012: right team, z +1.84 against +1.58, no "+8.3" | Right answer, stricter metric. "Relative to their league" invites a z-score |
| Defence question answered with net rating first (from the matchup fact) | 4 | comparison-001: leads with net rating z, then gives the defensive z | Partly wrong: the matchup fact pulls the model off the stat that was asked about |
| "Why" answer explains the shares but leaves out the probability | 4 | matchup-024 | A real gap. The prompt should require the chance in "why" answers |
| Ranking by raw value instead of relative to the league | 2 | ranking-020: 2020–21 Clippers .411, not the 2025–26 Nuggets (best z) | Wrong under the site's definition of "best" |
| Record given instead of win % | 2 | ranking-025: "72–10" for the 1995–96 Bulls | Right answer, stricter metric (records and percentages aren't matched to each other) |
| Comparison contradicts its own numbers | 1 | comparison-014: says the '08 Celtics had the better offence, then cites +0.7 against the Lakers' +1.4 | Wrong |
| Hedged non-answer | 1 | comparison-002 | Wrong |
| "Since 1985–86" answered with the 1985–86 leader | 1 | ranking-010: the 1985–86 Celtics, not the 2016–17 Warriors | Wrong: the season card outranks the all-time leaderboard |

So about 7 of the 20 misses are right answers the metric can't credit, and
about 13 are real errors. One answerable question was refused: method-015
("Why does it say SuperSonics and not Thunder…"), where the method chunk
wasn't retrieved (Session 3's pattern 2).

Qwen3 and Llama 3.1 8B show the same comparison and "why" patterns, plus the
betting failure. Llama 3.1 8B also refuses five answerable questions (stat-031,
stat-046, comparison-002, comparison-008, matchup-005). Its known unfaithful
answers are stat-017 (it treats points per game as points per 100
possessions) and ranking-010.

The number checks can't see a wrong conclusion drawn from right numbers.
Gemma 4's comparison-025 passes them while naming the wrong team, and the
judge is what surfaced it. Comparisons of two z-scores are the weak spot for
both contenders. Session 5 could state the winner in the tool fact, so the
model doesn't have to compare them itself.

### Test results (each row scored once, 2026-11-01 and 2026-11-03)

| Configuration | Numbers right | Right team | First pass | Grounded | Refusals | False refusals | Neurons | p50 / p95 ms |
|---|---|---|---|---|---|---|---|---|
| **Gemma 4 (shipped)** | **0.771** | **0.702** | **0.990** | **1.000** | **1.000** | 0.045 | 28.6 | 1,671 / 5,869 |
| Qwen3 | 0.686 | 0.681 | 0.888 | 0.918 | 0.750 | **0.000** | 16.7 | 816 / 2,540 |
| Llama 3.1 8B | 0.600 | 0.660 | 0.827 | 0.918 | 0.875 | 0.080 | **14.0** | **489** / **1,191** |
| Llama 3.1 8B, no tool facts | 0.543 | 0.617 | 0.724 | 0.867 | 0.875 | 0.114 | 13.7 | 593 / 1,434 |

n = 70 for numbers right, 47 for right team, 8 for refusals, 88 for false
refusals. No answer in any run contains a must-not-contain phrase. Retrieval
is the same in every row (context recall@5 0.948).

The dev ranking held on test, and Gemma 4 stays the choice:

- **Gemma 4 leads on every quality metric except false refusals**, and it is
  the only generator that refused all 8 must-refuse questions and whose answers
  all ended up grounded. It dropped about 5 points from dev on numbers right
  (0.818 to 0.771). Qwen3 and Llama 3.1 8B dropped about 9 points each.
- **Tool facts held up, by less than dev suggested.** Without them, numbers
  right falls 5.7 points (16 on dev), first pass 10 points and grounded 5
  points, and false refusals rise by 3.4 points. They stay.
- **The judge (unvalidated) scored Gemma 4's test answers** at faithfulness
  0.897 and citation support 0.896 on 45 of 50 judged answers, with 5 replies
  it couldn't parse. These count refusals as answers, so they compare with the
  dev "all" column (0.904), not with "answers only". Don't quote them as
  measured faithfulness.
- **Qwen3 gave one game margin to a decimal on test.** Gemma 4 and Llama 3.1 8B
  gave none.

Gemma 4 misses 16 of 70 number checks on test, read by hand:

| Pattern | Count | Example | Verdict |
|---|---|---|---|
| Comparison answered with z-scores, not the raw value the question set expects | 7 | comparison-033: right team, z +1.53 cited, no raw net rating | 6 name the right team, so they are right answers under a stricter metric. comparison-006 names the wrong team |
| Ranking names the wrong leader, or gives a different form of the number | 5 | ranking-008: the 1997–98 Celtics, not the expected 2005–06 Bobcats | 4 are wrong. ranking-024 is right but gives the record, not the win % |
| Answerable question refused | 2 | ranking-004, matchup-001 | Wrong. The right chunk wasn't in the 5 for ranking-004 |
| "Why" answer leaves out the chance | 2 | matchup-008, matchup-028 | A real gap, the same one dev found |

Four answerable questions are refused in all. For ranking-004 the leaderboard
wasn't in the 5 chunks. For method-009 it was, and the model refused anyway.
matchup-001 is a vague question on a matchup page. multihop-017 needs a second
hop. Stats, seasons, method
and multi-hop questions all score 1.000 on numbers right where they have
checks. So lookups are reliable, and rankings (and a few comparisons) are where
answers can still be wrong.

### Cost

Session 4's neurons, by Workers AI's own counts:
- 2026-10-27: about 2,470, the Llama 3.1 8B base run and judge calibration;
- 2026-10-28: 8,006, Qwen3, Llama 3.2 3B and half of Gemma 4;
- 2026-10-29: 7,824, the rest of Gemma 4 and the four ablations;
- 2026-10-30: 951, judge calls before the network failed;
- 2026-10-31: 5,549, the rest of the judge runs.

- 2026-11-01: 7,913, Gemma 4 with the judge and Llama 3.1 8B on test;
- 2026-11-03: 2,678, Qwen3 and no tool facts on test.

In total, Session 4 used about 35,400 neurons over 7 days. Each day stayed under the 10,000 free allowance. 2026-10-28 went 6 neurons
over the 8,000 dev cap, because the budget check estimates a call before it
is charged. Repeated calls come from the response cache and cost nothing.
