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
