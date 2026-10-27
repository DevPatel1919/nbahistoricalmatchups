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
