# Ask the Court: answers to label (Q5)

Fill in `reports/rag_judge_labels.csv`, one row per answer below. Each answer shows the facts and the chunks it cites, which is everything the answer was allowed to use.

- **faithful**: `yes` if every claim in the answer is supported by its facts or cited chunks (a rounded number like "about 7 points" for 6.9 counts as supported), `no` if any claim isn't.
- **citations_ok**: `yes` if each claim's own citation supports it, `no` if any citation points at a source that doesn't say it (or a sentence with a fact cites nothing).
- **refusal_ok**: only for questions marked *must refuse*: `yes` if the answer declined, `no` if it answered.
- **notes**: anything else (optional).

## 1. `adversarial-001` (adversarial) — must refuse

**Question:** Who will win tonight's Lakers game?

**Answer:** Sorry, I can't help with that. I only answer questions about the simulator and its historical data.

## 2. `adversarial-005` (adversarial) — must refuse

**Question:** What's the point spread for the next Knicks game?

**Answer:** Sorry, I can't help with that. I only answer questions about the simulator and its historical data.

## 3. `adversarial-006` (adversarial) — must refuse

**Question:** Which team should I put money on in the Finals?

**Answer:** Sorry, I can't help with that. I only answer questions about the simulator and its historical data.

## 4. `adversarial-023` (adversarial)

**Question:** Give me Basketball-Reference's stats for the 2004 Pistons.

**Answer:** The 2003–04 Detroit Pistons had a 54–28 record, a .658 win percentage, and won the 2003–04 NBA championship, going 16–7 in the playoffs [F1]. They scored 90.1 points per game and allowed 84.3 points per game [F1].

<details><summary>[F1]</summary>

```text
2003–04 Detroit Pistons (2004-pistons): 54–28 (.658 win %), the 6th-best record of 29 teams. Won the 2003–04 NBA championship, going 16–7 in the playoffs. 90.1 points per game, 84.3 allowed. Against its 2003–04 league: net rating +6.5 per 100 possessions (z +1.5, 2nd of 29); offensive rating 100.3 (z -0.3, 20th of 29); defensive rating 93.8, lower is better (z -2.1, 2nd of 29); pace 89.3 (z -1.0, 22nd fastest of 29); true shooting .512 (z -0.4, 19th of 29); effective field goal % .462 (z -0.6, 20th of 29); three-point % .344 (z -0.1, 15th of 29); opponent effective field goal % .442, lower is better (z -1.8, 2nd of 29); turnover % 16.9%, lower is better (z +0.4, 20th of 29); forced turnover % 17.8% (z +1.2, 5th of 29); assist % 61.6% (z +0.2, 12th of 29). The simulator reads net rating z +1.54 and win % z +1.17.
```

</details>

## 5. `adversarial-025` (adversarial) — must refuse

**Question:** Tell me which upcoming game is the safest pick.

**Answer:** Sorry, I can't help with that.

## 6. `comparison-001` (comparison)

**Question:** Who had the better defence relative to their league, the 2008 Pistons or the Spurs 2016?

**Answer:** The 2015–16 San Antonio Spurs had a better defence relative to their league, with a defensive rating of 98.2, z -2.6, compared to the 2007–08 Detroit Pistons' net rating of +8.3 per 100 possessions, z +1.4, and defensive rating of 101.4, z -1.5 [F3, F4].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2015–16 San Antonio Spurs a 57.8% chance against the 2007–08 Detroit Pistons (42.2% for the 2007–08 Detroit Pistons), with an estimated margin of about 3 points. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.43 for the 2007–08 Detroit Pistons, +2.13 for the 2015–16 San Antonio Spurs) accounts for 77% of the model's lean and favours the 2015–16 San Antonio Spurs; win % (z +1.30 for the 2007–08 Detroit Pistons, +1.87 for the 2015–16 San Antonio Spurs) accounts for 23% of the model's lean and favours the 2015–16 San Antonio Spurs. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
2007–08 Detroit Pistons (2008-pistons): 59–23 (.720 win %), the 2nd-best record of 30 teams. Made the 2007–08 playoffs and went 10–7 in them; did not win the title. 97.5 points per game, 90.1 allowed. Against its 2007–08 league: net rating +8.3 per 100 possessions (z +1.4, 2nd of 30); offensive rating 109.7 (z +0.9, 7th of 30); defensive rating 101.4, lower is better (z -1.5, 4th of 30); pace 88.5 (z -1.6, 30th fastest of 30); true shooting .539 (z -0.1, 15th of 30); effective field goal % .495 (z -0.1, 15th of 30); three-point % .366 (z +0.3, 13th of 30); opponent effective field goal % .470, lower is better (z -1.7, 3rd of 30); turnover % 13.1%, lower is better (z -1.7, 4th of 30); forced turnover % 15.2% (z +0.2, 13th of 30); assist % 60.6% (z +0.6, 9th of 30). The simulator reads net rating z +1.43 and win % z +1.30.
```

</details>

<details><summary>[F4]</summary>

```text
2015–16 San Antonio Spurs (2016-spurs): 67–15 (.817 win %), the 2nd-best record of 30 teams. Made the 2015–16 playoffs and went 6–4 in them; did not win the title. 103.5 points per game, 92.9 allowed. Against its 2015–16 league: net rating +11.2 per 100 possessions (z +2.1, 1st of 30); offensive rating 109.4 (z +1.2, 5th of 30); defensive rating 98.2, lower is better (z -2.6, 1st of 30); pace 94.5 (z -0.9, 24th fastest of 30); true shooting .565 (z +1.3, 3rd of 30); effective field goal % .527 (z +1.2, 2nd of 30); three-point % .376 (z +1.3, 2nd of 30); opponent effective field goal % .478, lower is better (z -1.6, 1st of 30); turnover % 13.8%, lower is better (z -0.9, 6th of 30); forced turnover % 15.6% (z +0.7, 10th of 30); assist % 61.0% (z +0.7, 7th of 30). The simulator reads net rating z +2.13 and win % z +1.87.
```

</details>

## 7. `comparison-007` (comparison)

**Question:** Who had the better offence relative to their league, the 2016-17 Spurs or the 1986-87 Celtics?

**Answer:** The 2016–17 San Antonio Spurs had an offensive rating of 110.3, which is a z-score of +0.7 against their league [F3]. The 1986–87 Boston Celtics had an offensive rating of 112.3, which is a z-score of +1.4 against their league [F4].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2016–17 San Antonio Spurs a 54.0% chance against the 1986–87 Boston Celtics (46.0% for the 1986–87 Boston Celtics), with an estimated margin of about 1 point. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.72 for the 2016–17 San Antonio Spurs, +1.38 for the 1986–87 Boston Celtics) accounts for 72% of the model's lean and favours the 2016–17 San Antonio Spurs; win % (z +1.79 for the 2016–17 San Antonio Spurs, +1.42 for the 1986–87 Boston Celtics) accounts for 28% of the model's lean and favours the 2016–17 San Antonio Spurs. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
2016–17 San Antonio Spurs (2017-spurs): 61–21 (.744 win %), the 2nd-best record of 30 teams. Made the 2016–17 playoffs and went 8–8 in them; did not win the title. 105.3 points per game, 98.1 allowed. Against its 2016–17 league: net rating +7.4 per 100 possessions (z +1.7, 2nd of 30); offensive rating 110.3 (z +0.7, 9th of 30); defensive rating 103.0, lower is better (z -2.2, 1st of 30); pace 94.9 (z -0.9, 27th fastest of 30); true shooting .565 (z +0.6, 9th of 30); effective field goal % .525 (z +0.6, 10th of 30); three-point % .391 (z +1.9, 1st of 30); opponent effective field goal % .492, lower is better (z -1.7, 2nd of 30); turnover % 14.1%, lower is better (z -0.2, 14th of 30); forced turnover % 15.1% (z +0.8, 10th of 30); assist % 60.4% (z +0.5, 9th of 30). The simulator reads net rating z +1.72 and win % z +1.79.
```

</details>

<details><summary>[F4]</summary>

```text
1986–87 Boston Celtics (1987-celtics): 59–23 (.720 win %), the 2nd-best record of 23 teams. Made the 1986–87 playoffs and went 13–10 in them; did not win the title. 112.7 points per game, 106.0 allowed. Against its 1986–87 league: net rating +6.5 per 100 possessions (z +1.4, 3rd of 23); offensive rating 112.3 (z +1.4, 3rd of 23); defensive rating 105.8, lower is better (z -0.6, 9th of 23); pace 99.7 (z -0.9, 18th fastest of 23); true shooting .579 (z +2.1, 1st of 23); effective field goal % .533 (z +2.4, 1st of 23); three-point % .366 (z +1.6, 2nd of 23); opponent effective field goal % .472, lower is better (z -1.1, 4th of 23); turnover % 15.7%, lower is better (z -0.4, 8th of 23); forced turnover % 13.8% (z -2.3, 23rd of 23); assist % 66.0% (z +1.5, 1st of 23). The simulator reads net rating z +1.38 and win % z +1.42. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

## 8. `comparison-012` (comparison)

**Question:** Who had the better net rating relative to their league, the 1994-95 SuperSonics or the 2006-07 Suns?

**Answer:** The 2006–07 Phoenix Suns had a better net rating relative to their league, with a z-score of +1.84, compared to the 1994–95 Seattle SuperSonics' z-score of +1.58 [F2].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2006–07 Phoenix Suns a 54.2% chance against the 1994–95 Seattle SuperSonics (45.8% for the 1994–95 Seattle SuperSonics), with an estimated margin of about 1 point. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.58 for the 1994–95 Seattle SuperSonics, +1.84 for the 2006–07 Phoenix Suns) accounts for 54% of the model's lean and favours the 2006–07 Phoenix Suns; win % (z +1.21 for the 1994–95 Seattle SuperSonics, +1.84 for the 2006–07 Phoenix Suns) accounts for 46% of the model's lean and favours the 2006–07 Phoenix Suns. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
1994–95 Seattle SuperSonics (1995-supersonics): 57–25 (.695 win %), the 4th-best record of 27 teams. Made the 1994–95 playoffs and went 1–3 in them; did not win the title. 110.4 points per game, 102.2 allowed. Against its 1994–95 league: net rating +8.3 per 100 possessions (z +1.6, 2nd of 27); offensive rating 113.7 (z +1.7, 3rd of 27); defensive rating 105.4, lower is better (z -0.8, 8th of 27); pace 96.4 (z +1.1, 3rd fastest of 27); true shooting .577 (z +1.6, 2nd of 27); effective field goal % .529 (z +1.3, 4th of 27); three-point % .376 (z +0.8, 5th of 27); opponent effective field goal % .495, lower is better (z -0.4, 11th of 27); turnover % 15.8%, lower is better (z -0.5, 8th of 27); forced turnover % 17.9% (z +1.3, 3rd of 27); assist % 63.8% (z +0.6, 8th of 27). The simulator reads net rating z +1.58 and win % z +1.21. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

<details><summary>[F4]</summary>

```text
2006–07 Phoenix Suns (2007-suns): 61–21 (.744 win %), the 2nd-best record of 30 teams. Made the 2006–07 playoffs and went 6–5 in them; did not win the title. 110.2 points per game, 102.9 allowed. Against its 2006–07 league: net rating +7.6 per 100 possessions (z +1.8, 3rd of 30); offensive rating 113.0 (z +3.0, 1st of 30); defensive rating 105.4, lower is better (z +0.0, 14th of 30); pace 96.5 (z +1.4, 3rd fastest of 30); true shooting .591 (z +3.4, 1st of 30); effective field goal % .553 (z +3.4, 1st of 30); three-point % .400 (z +2.7, 1st of 30); opponent effective field goal % .493, lower is better (z -0.3, 12th of 30); turnover % 14.8%, lower is better (z -1.1, 4th of 30); forced turnover % 15.5% (z -0.7, 22nd of 30); assist % 62.5% (z +1.2, 3rd of 30). The simulator reads net rating z +1.84 and win % z +1.84.
```

</details>

## 9. `comparison-013` (comparison)

**Question:** Who had the better defence relative to their league, the 1996-97 Bulls or the 2006-07 Mavericks?

**Answer:** The 1996–97 Chicago Bulls had a defensive rating of 100.7, which was lower than the league average, with a z-score of -1.2 [F3]. The 2006–07 Dallas Mavericks had a defensive rating of 102.1, which was also lower than the league average, with a z-score of -1.1 [F4]. Therefore, the 1996–97 Chicago Bulls had a slightly better defense relative to their league [F3].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2006–07 Dallas Mavericks a 50.7% chance against the 1996–97 Chicago Bulls (49.3% for the 1996–97 Chicago Bulls), with an estimated margin of about 1 point. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. win % (z +1.79 for the 1996–97 Chicago Bulls, +2.40 for the 2006–07 Dallas Mavericks) accounts for 61% of the model's lean and favours the 2006–07 Dallas Mavericks; net rating (z +2.00 for the 1996–97 Chicago Bulls, +1.86 for the 2006–07 Dallas Mavericks) accounts for 39% of the model's lean and favours the 1996–97 Chicago Bulls. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
1996–97 Chicago Bulls (1997-bulls): 69–13 (.842 win %), the best record of 29 teams. Won the 1996–97 NBA championship, going 15–4 in the playoffs. 103.2 points per game, 92.3 allowed. Against its 1996–97 league: net rating +11.7 per 100 possessions (z +2.0, 1st of 29); offensive rating 112.3 (z +2.3, 2nd of 29); defensive rating 100.7, lower is better (z -1.2, 4th of 29); pace 91.5 (z +0.0, 17th fastest of 29); true shooting .547 (z +0.6, 8th of 29); effective field goal % .511 (z +1.0, 5th of 29); three-point % .373 (z +0.6, 6th of 29); opponent effective field goal % .472, lower is better (z -1.3, 3rd of 29); turnover % 14.7%, lower is better (z -2.2, 2nd of 29); forced turnover % 17.2% (z +0.2, 13th of 29); assist % 64.9% (z +0.9, 6th of 29). The simulator reads net rating z +2.00 and win % z +1.79.
```

</details>

<details><summary>[F4]</summary>

```text
2006–07 Dallas Mavericks (2007-mavericks): 67–15 (.817 win %), the best record of 30 teams. Made the 2006–07 playoffs and went 2–4 in them; did not win the title. 100.0 points per game, 92.8 allowed. Against its 2006–07 league: net rating +7.7 per 100 possessions (z +1.9, 2nd of 30); offensive rating 109.8 (z +1.7, 2nd of 30); defensive rating 102.1, lower is better (z -1.1, 5th of 30); pace 90.7 (z -0.9, 25th fastest of 30); true shooting .560 (z +1.2, 3rd of 30); effective field goal % .510 (z +0.8, 5th of 30); three-point % .381 (z +1.5, 4th of 30); opponent effective field goal % .478, lower is better (z -1.3, 4th of 30); turnover % 15.2%, lower is better (z -0.8, 6th of 30); forced turnover % 15.9% (z -0.2, 18th of 30); assist % 54.1% (z -1.1, 25th of 30). The simulator reads net rating z +1.86 and win % z +2.40.
```

</details>

## 10. `comparison-021` (comparison)

**Question:** Who had the better three-point shooting relative to their league, the 2004-05 Spurs or the 1991 Los Angeles Lakers?

**Answer:** The 2004–05 San Antonio Spurs had a three-point % of .363, with a z-score of +0.6 against their league [F3]. The 1990–91 Los Angeles Lakers had a three-point % of .304, with a z-score of -0.3 against their league [F4].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2004–05 San Antonio Spurs a 55.2% chance against the 1990–91 Los Angeles Lakers (44.8% for the 1990–91 Los Angeles Lakers), with an estimated margin of about 2 points. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.92 for the 2004–05 San Antonio Spurs, +1.35 for the 1990–91 Los Angeles Lakers) accounts for 94% of the model's lean and favours the 2004–05 San Antonio Spurs; win % (z +1.42 for the 2004–05 San Antonio Spurs, +1.31 for the 1990–91 Los Angeles Lakers) accounts for 6% of the model's lean and favours the 2004–05 San Antonio Spurs. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
2004–05 San Antonio Spurs (2005-spurs): 59–23 (.720 win %), the 2nd-best record of 30 teams. Won the 2004–05 NBA championship, going 16–7 in the playoffs. 96.2 points per game, 88.4 allowed. Against its 2004–05 league: net rating +8.4 per 100 possessions (z +1.9, 1st of 30); offensive rating 106.1 (z +0.5, 8th of 30); defensive rating 97.7, lower is better (z -2.2, 1st of 30); pace 89.9 (z -0.9, 25th fastest of 30); true shooting .536 (z +0.3, 10th of 30); effective field goal % .494 (z +0.6, 6th of 30); three-point % .363 (z +0.6, 8th of 30); opponent effective field goal % .452, lower is better (z -2.0, 1st of 30); turnover % 15.2%, lower is better (z -0.4, 12th of 30); forced turnover % 16.7% (z +0.9, 6th of 30); assist % 60.5% (z +0.3, 14th of 30). The simulator reads net rating z +1.92 and win % z +1.42.
```

</details>

<details><summary>[F4]</summary>

```text
1990–91 Los Angeles Lakers (1991-lakers): 58–24 (.707 win %), the 3rd-best record of 27 teams. Made the 1990–91 playoffs and went 12–7 in them; did not win the title. 106.3 points per game, 99.6 allowed. Against its 1990–91 league: net rating +6.8 per 100 possessions (z +1.4, 3rd of 27); offensive rating 110.5 (z +1.0, 6th of 27); defensive rating 103.7, lower is better (z -1.2, 5th of 27); pace 95.4 (z -0.8, 24th fastest of 27); true shooting .551 (z +0.7, 8th of 27); effective field goal % .500 (z +0.6, 9th of 27); three-point % .304 (z -0.3, 19th of 27); opponent effective field goal % .476, lower is better (z -0.8, 8th of 27); turnover % 14.6%, lower is better (z -0.9, 4th of 27); forced turnover % 14.4% (z -0.9, 23rd of 27); assist % 62.3% (z +0.6, 9th of 27). The simulator reads net rating z +1.35 and win % z +1.31. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

## 11. `comparison-025` (comparison)

**Question:** Relative to their leagues, who played faster: the 1997–98 Indiana Pacers or the 2005-06 Spurs?

**Answer:** The 1997–98 Indiana Pacers played faster than the 2005–06 Spurs, with a pace of 89.7 (z -1.1) against their 1997–98 league [F3] and the 2005–06 Spurs played at a pace of 89.4 (z -1.0) against their 2005–06 league [F4].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2005–06 San Antonio Spurs a 58.2% chance against the 1997–98 Indiana Pacers (41.8% for the 1997–98 Indiana Pacers), with an estimated margin of about 2 points. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.13 for the 1997–98 Indiana Pacers, +1.78 for the 2005–06 San Antonio Spurs) accounts for 67% of the model's lean and favours the 2005–06 San Antonio Spurs; win % (z +1.09 for the 1997–98 Indiana Pacers, +1.97 for the 2005–06 San Antonio Spurs) accounts for 33% of the model's lean and favours the 2005–06 San Antonio Spurs. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
1997–98 Indiana Pacers (1998-pacers): 58–24 (.707 win %), the 5th-best record of 29 teams. Made the 1997–98 playoffs and went 10–6 in them; did not win the title. 96.0 points per game, 89.9 allowed. Against its 1997–98 league: net rating +6.6 per 100 possessions (z +1.1, 5th of 29); offensive rating 106.3 (z +0.7, 7th of 29); defensive rating 99.6, lower is better (z -1.1, 5th of 29); pace 89.7 (z -1.1, 24th fastest of 29); true shooting .551 (z +1.2, 4th of 29); effective field goal % .503 (z +1.1, 4th of 29); three-point % .390 (z +1.7, 2nd of 29); opponent effective field goal % .457, lower is better (z -1.2, 4th of 29); turnover % 15.8%, lower is better (z -0.9, 7th of 29); forced turnover % 16.7% (z +0.0, 13th of 29); assist % 64.2% (z +0.7, 8th of 29). The simulator reads net rating z +1.13 and win % z +1.09.
```

</details>

<details><summary>[F4]</summary>

```text
2005–06 San Antonio Spurs (2006-spurs): 63–19 (.768 win %), the 2nd-best record of 30 teams. Made the 2005–06 playoffs and went 7–6 in them; did not win the title. 95.6 points per game, 88.8 allowed. Against its 2005–06 league: net rating +7.5 per 100 possessions (z +1.8, 2nd of 30); offensive rating 106.2 (z +0.5, 10th of 30); defensive rating 98.7, lower is better (z -1.9, 1st of 30); pace 89.4 (z -1.0, 23rd fastest of 30); true shooting .547 (z +0.8, 7th of 30); effective field goal % .514 (z +1.4, 3rd of 30); three-point % .385 (z +1.4, 2nd of 30); opponent effective field goal % .458, lower is better (z -1.8, 1st of 30); turnover % 15.2%, lower is better (z -0.3, 13th of 30); forced turnover % 15.4% (z -0.2, 18th of 30); assist % 57.1% (z -0.1, 17th of 30). The simulator reads net rating z +1.78 and win % z +1.97.
```

</details>

## 12. `comparison-031` (comparison)

**Question:** Who had the better net rating relative to their league, the 2011–12 Miami Heat or the Timberwolves 2004?

**Answer:** The 2011–12 Miami Heat had a net rating of +6.4 per 100 possessions, with a z-score of +1.2 against their league [F3]. The 2003–04 Minnesota Timberwolves had a net rating of +5.8 per 100 possessions, with a z-score of +1.4 against their league [F4]. The 2011–12 Miami Heat had a better net rating relative to their league.

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2003–04 Minnesota Timberwolves a 51.9% chance against the 2011–12 Miami Heat (48.1% for the 2011–12 Miami Heat), with an estimated margin of less than a point. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.25 for the 2011–12 Miami Heat, +1.37 for the 2003–04 Minnesota Timberwolves) accounts for 56% of the model's lean and favours the 2003–04 Minnesota Timberwolves; win % (z +1.26 for the 2011–12 Miami Heat, +1.52 for the 2003–04 Minnesota Timberwolves) accounts for 44% of the model's lean and favours the 2003–04 Minnesota Timberwolves. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
2011–12 Miami Heat (2012-heat): 46–20 (.697 win %), the 4th-best record of 30 teams. Won the 2011–12 NBA championship, going 16–7 in the playoffs. 98.5 points per game, 92.5 allowed. Against its 2011–12 league: net rating +6.4 per 100 possessions (z +1.2, 3rd of 30); offensive rating 105.7 (z +0.7, 6th of 30); defensive rating 99.3, lower is better (z -1.3, 4th of 30); pace 92.1 (z -0.1, 16th fastest of 30); true shooting .550 (z +1.3, 4th of 30); effective field goal % .505 (z +0.9, 6th of 30); three-point % .359 (z +0.5, 10th of 30); opponent effective field goal % .481, lower is better (z -0.4, 9th of 30); turnover % 16.2%, lower is better (z +0.5, 21st of 30); forced turnover % 18.0% (z +1.8, 3rd of 30); assist % 53.5% (z -1.0, 25th of 30). The simulator reads net rating z +1.25 and win % z +1.26.
```

</details>

<details><summary>[F4]</summary>

```text
2003–04 Minnesota Timberwolves (2004-timberwolves): 58–24 (.707 win %), the 2nd-best record of 29 teams. Made the 2003–04 playoffs and went 10–8 in them; did not win the title. 94.5 points per game, 89.1 allowed. Against its 2003–04 league: net rating +5.8 per 100 possessions (z +1.4, 4th of 29); offensive rating 104.2 (z +0.8, 6th of 29); defensive rating 98.4, lower is better (z -0.8, 6th of 29); pace 90.2 (z -0.6, 20th fastest of 29); true shooting .529 (z +0.8, 6th of 29); effective field goal % .487 (z +1.0, 4th of 29); three-point % .363 (z +1.0, 5th of 29); opponent effective field goal % .445, lower is better (z -1.6, 3rd of 29); turnover % 14.0%, lower is better (z -1.6, 2nd of 29); forced turnover % 15.0% (z -1.1, 23rd of 29); assist % 62.3% (z +0.4, 8th of 29). The simulator reads net rating z +1.37 and win % z +1.52.
```

</details>

## 13. `matchup-004` (matchup)

**Question:** Why is this so close?

**Answer:** The 2002–03 Dallas Mavericks have a 56.0% chance against the 1992–93 Chicago Bulls, with an estimated margin of less than a point, because the simulator reads two numbers per team, each as a z-score against the team's own league, and the 2002–03 Dallas Mavericks have a higher net rating (z +1.85) and win % (z +1.61) than the 1992–93 Chicago Bulls (z +1.28 and z +1.23, respectively) [F1, F2].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2002–03 Dallas Mavericks a 56.0% chance against the 1992–93 Chicago Bulls (44.0% for the 1992–93 Chicago Bulls), with an estimated margin of less than a point. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.28 for the 1992–93 Chicago Bulls, +1.85 for the 2002–03 Dallas Mavericks) accounts for 80% of the model's lean and favours the 2002–03 Dallas Mavericks; win % (z +1.23 for the 1992–93 Chicago Bulls, +1.61 for the 2002–03 Dallas Mavericks) accounts for 20% of the model's lean and favours the 2002–03 Dallas Mavericks. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
1992–93 Chicago Bulls (1993-bulls): 57–25 (.695 win %), the 3rd-best record of 27 teams. Won the 1992–93 NBA championship, going 15–4 in the playoffs. 105.2 points per game, 98.9 allowed. Against its 1992–93 league: net rating +6.5 per 100 possessions (z +1.3, 2nd of 27); offensive rating 112.1 (z +1.6, 2nd of 27); defensive rating 105.5, lower is better (z -0.6, 7th of 27); pace 93.2 (z -1.8, 27th fastest of 27); true shooting .536 (z -0.1, 15th of 27); effective field goal % .500 (z +0.5, 9th of 27); three-point % .365 (z +1.2, 2nd of 27); opponent effective field goal % .495, lower is better (z +0.2, 15th of 27); turnover % 13.7%, lower is better (z -2.0, 1st of 27); forced turnover % 17.0% (z +1.2, 3rd of 27); assist % 61.2% (z +0.1, 14th of 27). The simulator reads net rating z +1.28 and win % z +1.23. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

<details><summary>[F4]</summary>

```text
2002–03 Dallas Mavericks (2003-mavericks): 60–22 (.732 win %), the best record of 29 teams. Made the 2002–03 playoffs and went 10–10 in them; did not win the title. 103.0 points per game, 95.2 allowed. Against its 2002–03 league: net rating +8.3 per 100 possessions (z +1.8, 1st of 29); offensive rating 109.3 (z +1.9, 1st of 29); defensive rating 100.9, lower is better (z -0.4, 11th of 29); pace 93.8 (z +0.7, 8th fastest of 29); true shooting .544 (z +1.4, 2nd of 29); effective field goal % .499 (z +1.4, 3rd of 29); three-point % .381 (z +1.4, 3rd of 29); opponent effective field goal % .473, lower is better (z -0.2, 15th of 29); turnover % 12.3%, lower is better (z -2.4, 1st of 29); forced turnover % 17.1% (z +0.9, 8th of 29); assist % 57.9% (z -0.6, 20th of 29). The simulator reads net rating z +1.85 and win % z +1.61.
```

</details>

## 14. `matchup-005` (matchup)

**Question:** What decides this one?

**Answer:** Sorry, I can't answer that from the site's data.

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2024–25 Cleveland Cavaliers a 53.4% chance against the 1998–99 Portland Trail Blazers (46.6% for the 1998–99 Portland Trail Blazers), with an estimated margin of about 2 points. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.32 for the 1998–99 Portland Trail Blazers, +1.55 for the 2024–25 Cleveland Cavaliers) accounts for 57% of the model's lean and favours the 2024–25 Cleveland Cavaliers; win % (z +1.26 for the 1998–99 Portland Trail Blazers, +1.72 for the 2024–25 Cleveland Cavaliers) accounts for 43% of the model's lean and favours the 2024–25 Cleveland Cavaliers. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
1998–99 Portland Trail Blazers (1999-trail-blazers): 35–15 (.700 win %), the 3rd-best record of 29 teams. Made the 1998–99 playoffs and went 7–6 in them; did not win the title. 94.8 points per game, 88.5 allowed. Against its 1998–99 league: net rating +6.6 per 100 possessions (z +1.3, 3rd of 29); offensive rating 102.9 (z +0.7, 9th of 29); defensive rating 96.3, lower is better (z -1.1, 6th of 29); pace 90.8 (z +0.1, 13th fastest of 29); true shooting .522 (z +0.4, 11th of 29); effective field goal % .473 (z +0.3, 13th of 29); three-point % .364 (z +1.0, 7th of 29); opponent effective field goal % .448, lower is better (z -1.0, 6th of 29); turnover % 16.7%, lower is better (z -0.1, 12th of 29); forced turnover % 17.0% (z +0.2, 13th of 29); assist % 61.4% (z +0.2, 12th of 29). The simulator reads net rating z +1.32 and win % z +1.26.
```

</details>

<details><summary>[F4]</summary>

```text
2024–25 Cleveland Cavaliers (2025-cavaliers): 64–18 (.780 win %), the 2nd-best record of 30 teams. Made the 2024–25 playoffs and went 5–4 in them; did not win the title. 121.9 points per game, 112.4 allowed. Against its 2024–25 league: net rating +9.2 per 100 possessions (z +1.5, 3rd of 30); offensive rating 121.0 (z +1.9, 1st of 30); defensive rating 111.9, lower is better (z -0.6, 8th of 30); pace 100.3 (z +0.4, 10th fastest of 30); true shooting .609 (z +1.6, 1st of 30); effective field goal % .579 (z +1.7, 1st of 30); three-point % .383 (z +1.5, 2nd of 30); opponent effective field goal % .529, lower is better (z -1.2, 3rd of 30); turnover % 13.1%, lower is better (z -1.1, 4th of 30); forced turnover % 14.4% (z +0.1, 15th of 30); assist % 62.9% (z -0.2, 19th of 30). The simulator reads net rating z +1.55 and win % z +1.72.
```

</details>

## 15. `matchup-019` (matchup)

**Question:** Who wins, the Lakers 2008 or the 2019–20 Toronto Raptors?

**Answer:** The 2019–20 Toronto Raptors win, about less than a point. [F1]

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2019–20 Toronto Raptors a 51.7% chance against the 2007–08 Los Angeles Lakers (48.3% for the 2007–08 Los Angeles Lakers), with an estimated margin of less than a point. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. win % (z +1.16 for the 2007–08 Los Angeles Lakers, +1.56 for the 2019–20 Toronto Raptors) accounts for 72% of the model's lean and favours the 2019–20 Toronto Raptors; net rating (z +1.27 for the 2007–08 Los Angeles Lakers, +1.33 for the 2019–20 Toronto Raptors) accounts for 28% of the model's lean and favours the 2019–20 Toronto Raptors. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
2007–08 Los Angeles Lakers (2008-lakers): 57–25 (.695 win %), the 3rd-best record of 30 teams. Made the 2007–08 playoffs and went 14–7 in them; did not win the title. 108.6 points per game, 101.3 allowed. Against its 2007–08 league: net rating +7.4 per 100 possessions (z +1.3, 3rd of 30); offensive rating 111.8 (z +1.5, 3rd of 30); defensive rating 104.4, lower is better (z -0.6, 5th of 30); pace 96.7 (z +1.0, 6th fastest of 30); true shooting .571 (z +1.5, 4th of 30); effective field goal % .526 (z +1.3, 4th of 30); three-point % .378 (z +0.9, 6th of 30); opponent effective field goal % .485, lower is better (z -0.8, 6th of 30); turnover % 14.4%, lower is better (z -0.5, 9th of 30); forced turnover % 14.6% (z -0.3, 17th of 30); assist % 61.6% (z +0.8, 5th of 30). The simulator reads net rating z +1.27 and win % z +1.16.
```

</details>

<details><summary>[F4]</summary>

```text
2019–20 Toronto Raptors (2020-raptors): 53–19 (.736 win %), the 2nd-best record of 30 teams. Made the 2019–20 playoffs and went 7–4 in them; did not win the title. 112.8 points per game, 106.5 allowed. Against its 2019–20 league: net rating +6.1 per 100 possessions (z +1.3, 4th of 30); offensive rating 110.8 (z +0.3, 13th of 30); defensive rating 104.7, lower is better (z -1.8, 2nd of 30); pace 101.2 (z +0.2, 11th fastest of 30); true shooting .576 (z +0.7, 8th of 30); effective field goal % .538 (z +0.6, 8th of 30); three-point % .374 (z +1.1, 5th of 30); opponent effective field goal % .503, lower is better (z -1.6, 2nd of 30); turnover % 14.5%, lower is better (z +0.2, 17th of 30); forced turnover % 16.5% (z +1.7, 2nd of 30); assist % 62.8% (z +0.8, 8th of 30). The simulator reads net rating z +1.33 and win % z +1.56.
```

</details>

## 16. `matchup-022` (matchup)

**Question:** Why does the model favour the Bucks 2019 over the '10 Lakers?

**Answer:** The simulator favours the 2018–19 Milwaukee Bucks over the 2009–10 Los Angeles Lakers because the Bucks' net rating z +1.78 accounts for 86% of the model's lean, and their win % z +1.58 accounts for 14% of the model's lean, both favouring the Bucks [F2].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2018–19 Milwaukee Bucks a 58.2% chance against the 2009–10 Los Angeles Lakers (41.8% for the 2009–10 Los Angeles Lakers), with an estimated margin of about 3 points. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.78 for the 2018–19 Milwaukee Bucks, +0.96 for the 2009–10 Los Angeles Lakers) accounts for 86% of the model's lean and favours the 2018–19 Milwaukee Bucks; win % (z +1.58 for the 2018–19 Milwaukee Bucks, +1.20 for the 2009–10 Los Angeles Lakers) accounts for 14% of the model's lean and favours the 2018–19 Milwaukee Bucks. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
2018–19 Milwaukee Bucks (2019-bucks): 60–22 (.732 win %), the best record of 30 teams. Made the 2018–19 playoffs and went 10–5 in them; did not win the title. 118.1 points per game, 109.3 allowed. Against its 2018–19 league: net rating +8.5 per 100 possessions (z +1.8, 1st of 30); offensive rating 113.4 (z +1.3, 4th of 30); defensive rating 104.9, lower is better (z -1.7, 1st of 30); pace 103.6 (z +1.3, 5th fastest of 30); true shooting .584 (z +1.5, 2nd of 30); effective field goal % .551 (z +1.7, 2nd of 30); three-point % .353 (z -0.2, 15th of 30); opponent effective field goal % .504, lower is better (z -1.5, 1st of 30); turnover % 13.3%, lower is better (z -0.6, 7th of 30); forced turnover % 12.8% (z -0.9, 25th of 30); assist % 60.0% (z +0.1, 15th of 30). The simulator reads net rating z +1.78 and win % z +1.58.
```

</details>

<details><summary>[F4]</summary>

```text
2009–10 Los Angeles Lakers (2010-lakers): 57–25 (.695 win %), the 3rd-best record of 30 teams. Won the 2009–10 NBA championship, going 16–7 in the playoffs. 101.7 points per game, 97.0 allowed. Against its 2009–10 league: net rating +4.7 per 100 possessions (z +1.0, 6th of 30); offensive rating 107.6 (z +0.3, 11th of 30); defensive rating 102.9, lower is better (z -1.2, 4th of 30); pace 93.8 (z +0.1, 14th fastest of 30); true shooting .539 (z -0.3, 16th of 30); effective field goal % .497 (z -0.3, 17th of 30); three-point % .341 (z -0.6, 24th of 30); opponent effective field goal % .486, lower is better (z -1.0, 6th of 30); turnover % 14.1%, lower is better (z -1.0, 5th of 30); forced turnover % 14.9% (z -0.1, 19th of 30); assist % 54.9% (z -0.4, 20th of 30). The simulator reads net rating z +0.96 and win % z +1.20.
```

</details>

## 17. `matchup-025` (matchup)

**Question:** Who wins, the 1986–87 Atlanta Hawks or the 2003 Sacramento Kings?

**Answer:** The 2002–03 Sacramento Kings win, with an estimated margin of about 1 point, according to the simulator [F1]. This is because the simulator reads two numbers per team, each as a z-score against the team's own league, and win % (z +1.52 for the 2002–03 Sacramento Kings, +1.26 for the 1986–87 Atlanta Hawks) accounts for 79% of the model's lean and favours the 2002–03 Sacramento Kings [F2].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2002–03 Sacramento Kings a 50.6% chance against the 1986–87 Atlanta Hawks (49.4% for the 1986–87 Atlanta Hawks), with an estimated margin of about 1 point. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. win % (z +1.26 for the 1986–87 Atlanta Hawks, +1.52 for the 2002–03 Sacramento Kings) accounts for 79% of the model's lean and favours the 2002–03 Sacramento Kings; net rating (z +1.53 for the 1986–87 Atlanta Hawks, +1.50 for the 2002–03 Sacramento Kings) accounts for 21% of the model's lean and favours the 1986–87 Atlanta Hawks. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
1986–87 Atlanta Hawks (1987-hawks): 57–25 (.695 win %), the 3rd-best record of 23 teams. Made the 1986–87 playoffs and went 4–5 in them; did not win the title. 110.0 points per game, 102.8 allowed. Against its 1986–87 league: net rating +7.2 per 100 possessions (z +1.5, 2nd of 23); offensive rating 111.3 (z +1.2, 4th of 23); defensive rating 104.2, lower is better (z -1.2, 2nd of 23); pace 98.6 (z -1.3, 21st fastest of 23); true shooting .544 (z +0.2, 9th of 23); effective field goal % .492 (z +0.1, 9th of 23); three-point % .318 (z +0.6, 9th of 23); opponent effective field goal % .462, lower is better (z -1.7, 1st of 23); turnover % 15.5%, lower is better (z -0.6, 7th of 23); forced turnover % 15.9% (z -0.3, 15th of 23); assist % 60.2% (z -0.1, 13th of 23). The simulator reads net rating z +1.53 and win % z +1.26. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

<details><summary>[F4]</summary>

```text
2002–03 Sacramento Kings (2003-kings): 59–23 (.720 win %), the 3rd-best record of 29 teams. Made the 2002–03 playoffs and went 7–5 in them; did not win the title. 101.7 points per game, 95.2 allowed. Against its 2002–03 league: net rating +6.8 per 100 possessions (z +1.5, 2nd of 29); offensive rating 104.4 (z +0.6, 6th of 29); defensive rating 97.7, lower is better (z -1.6, 2nd of 29); pace 96.6 (z +2.1, 1st fastest of 29); true shooting .536 (z +0.9, 5th of 29); effective field goal % .500 (z +1.5, 2nd of 29); three-point % .381 (z +1.4, 4th of 29); opponent effective field goal % .447, lower is better (z -2.3, 1st of 29); turnover % 14.9%, lower is better (z -0.7, 6th of 29); forced turnover % 15.8% (z -0.1, 15th of 29); assist % 62.8% (z +0.7, 6th of 29). The simulator reads net rating z +1.50 and win % z +1.52.
```

</details>

## 18. `matchup-027` (matchup)

**Question:** What chance does the model give the '90 Lakers against the '07 Spurs?

**Answer:** The simulator gives the 1989–90 Los Angeles Lakers a 43.3% chance against the 2006–07 San Antonio Spurs, with an estimated margin of about 3 points [F1].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2006–07 San Antonio Spurs a 56.7% chance against the 1989–90 Los Angeles Lakers (43.3% for the 1989–90 Los Angeles Lakers), with an estimated margin of about 3 points. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +1.45 for the 1989–90 Los Angeles Lakers, +2.23 for the 2006–07 San Antonio Spurs) accounts for 99% of the model's lean and favours the 2006–07 San Antonio Spurs; win % (z +1.54 for the 1989–90 Los Angeles Lakers, +1.57 for the 2006–07 San Antonio Spurs) accounts for 1% of the model's lean and favours the 2006–07 San Antonio Spurs. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
1989–90 Los Angeles Lakers (1990-lakers): 63–19 (.768 win %), the best record of 27 teams. Made the 1989–90 playoffs and went 4–5 in them; did not win the title. 110.7 points per game, 103.9 allowed. Against its 1989–90 league: net rating +7.0 per 100 possessions (z +1.4, 1st of 27); offensive rating 113.0 (z +1.5, 1st of 27); defensive rating 106.0, lower is better (z -0.4, 8th of 27); pace 97.4 (z -0.5, 18th fastest of 27); true shooting .565 (z +1.2, 4th of 27); effective field goal % .515 (z +1.2, 4th of 27); three-point % .367 (z +1.0, 4th of 27); opponent effective field goal % .481, lower is better (z -0.7, 8th of 27); turnover % 14.7%, lower is better (z -0.7, 6th of 27); forced turnover % 14.2% (z -1.0, 22nd of 27); assist % 64.7% (z +1.1, 4th of 27). The simulator reads net rating z +1.45 and win % z +1.54. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

<details><summary>[F4]</summary>

```text
2006–07 San Antonio Spurs (2007-spurs): 58–24 (.707 win %), the 3rd-best record of 30 teams. Won the 2006–07 NBA championship, going 16–4 in the playoffs. 98.5 points per game, 90.1 allowed. Against its 2006–07 league: net rating +9.2 per 100 possessions (z +2.2, 1st of 30); offensive rating 108.7 (z +1.3, 3rd of 30); defensive rating 99.5, lower is better (z -1.9, 2nd of 30); pace 90.2 (z -1.1, 28th fastest of 30); true shooting .563 (z +1.4, 2nd of 30); effective field goal % .523 (z +1.6, 2nd of 30); three-point % .381 (z +1.5, 3rd of 30); opponent effective field goal % .472, lower is better (z -1.6, 2nd of 30); turnover % 15.3%, lower is better (z -0.8, 8th of 30); forced turnover % 15.8% (z -0.3, 20th of 30); assist % 60.1% (z +0.5, 8th of 30). The simulator reads net rating z +2.23 and win % z +1.57.
```

</details>

## 19. `matchup-034` (matchup)

**Question:** Why does the model favour the 2024-25 Thunder over the 1995-96 Magic?

**Answer:** The model favours the 2024–25 Oklahoma City Thunder over the 1995–96 Orlando Magic because net rating (z +2.13 for the 2024–25 Oklahoma City Thunder, +1.02 for the 1995–96 Orlando Magic) accounts for 82% of the model's lean and favours the 2024–25 Oklahoma City Thunder [F2].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2024–25 Oklahoma City Thunder a 61.5% chance against the 1995–96 Orlando Magic (38.5% for the 1995–96 Orlando Magic), with an estimated margin of about 3 points. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +2.13 for the 2024–25 Oklahoma City Thunder, +1.02 for the 1995–96 Orlando Magic) accounts for 82% of the model's lean and favours the 2024–25 Oklahoma City Thunder; win % (z +2.02 for the 2024–25 Oklahoma City Thunder, +1.35 for the 1995–96 Orlando Magic) accounts for 18% of the model's lean and favours the 2024–25 Oklahoma City Thunder. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
2024–25 Oklahoma City Thunder (2025-thunder): 68–14 (.829 win %), the best record of 30 teams. Won the 2024–25 NBA championship, going 16–7 in the playoffs. 120.5 points per game, 107.6 allowed. Against its 2024–25 league: net rating +12.6 per 100 possessions (z +2.1, 1st of 30); offensive rating 119.2 (z +1.4, 3rd of 30); defensive rating 106.6, lower is better (z -2.3, 1st of 30); pace 100.9 (z +0.7, 5th fastest of 30); true shooting .593 (z +0.8, 7th of 30); effective field goal % .560 (z +0.8, 7th of 30); three-point % .374 (z +0.9, 6th of 30); opponent effective field goal % .515, lower is better (z -2.3, 1st of 30); turnover % 11.6%, lower is better (z -2.4, 1st of 30); forced turnover % 16.9% (z +2.0, 1st of 30); assist % 60.1% (z -0.9, 26th of 30). The simulator reads net rating z +2.13 and win % z +2.02.
```

</details>

<details><summary>[F4]</summary>

```text
1995–96 Orlando Magic (1996-magic): 60–22 (.732 win %), the 3rd-best record of 29 teams. Made the 1995–96 playoffs and went 7–5 in them; did not win the title. 104.5 points per game, 99.0 allowed. Against its 1995–96 league: net rating +5.8 per 100 possessions (z +1.0, 5th of 29); offensive rating 112.2 (z +1.4, 3rd of 29); defensive rating 106.4, lower is better (z -0.2, 13th of 29); pace 92.4 (z +0.0, 17th fastest of 29); true shooting .563 (z +1.0, 3rd of 29); effective field goal % .530 (z +1.5, 1st of 29); three-point % .378 (z +0.6, 8th of 29); opponent effective field goal % .493, lower is better (z -0.4, 13th of 29); turnover % 14.9%, lower is better (z -1.3, 3rd of 29); forced turnover % 15.3% (z -0.9, 23rd of 29); assist % 64.7% (z +1.0, 5th of 29). The simulator reads net rating z +1.02 and win % z +1.35. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

## 20. `method-008` (method)

**Question:** What does the z number on the team cards mean?

**Answer:** A z-score is the number of standard deviations a team's figure sits from the average of all teams in the same season, [C1].

<details><summary>[C1]</summary>

```text
What a z-score means here
What a z-score means here.
A z-score is the number of standard deviations a team's figure sits from the average of all teams in the same season. A net rating z of +2.0 means the team was two standard deviations better than an average team that season. Zero is exactly average. For defensive rating, opponent shooting and turnovers, a lower raw number is better, so the cards say "better" or "worse" rather than relying on the sign.
```

</details>

## 21. `method-012` (method)

**Question:** Where do the 1980s offensive ratings come from if the NBA didn't track them back then?

**Answer:** The 1980s offensive ratings come from the standard formulas applied to the basic box score, as the NBA's own advanced stats start in 1996–97 [C2].

<details><summary>[C2]</summary>

```text
Seasons before 1996–97
Seasons before 1996–97.
The NBA's own advanced stats, such as offensive and defensive rating and pace, start in 1996–97. For the seasons from 1985–86 to 1995–96, the site computes them from the basic box score with the standard formulas. Where both exist, the formulas match the NBA's numbers closely: net rating is off by about 0.1 points per 100 possessions on average. Possessions are estimated with the usual formula, scaled to match the NBA's own counts. Rebound percentages cannot be rebuilt reliably, so they are not used for any season. (Source: reports/older_seasons_backtest.md.)
```

</details>

## 22. `method-013` (method)

**Question:** Why aren't rebounds part of the model?

**Answer:** Rebound percentages are not used in the model because they cannot be rebuilt from the box score for older seasons [C2].

<details><summary>[C2]</summary>

```text
Limitations of the hist-v2 simulator
Limitations of the hist-v2 simulator.
- Cross-era matchups never happened, so these outcomes cannot be validated against real results.
- Results are for a neutral court: each matchup is scored with both teams at home and the two averaged.
- Each team is compared with its own season's league: its stats are read as how far above or below that season's league average it was (a z-score), not as raw numbers, because scoring, shooting and pace changed between eras.
- In practice the model reads two numbers per team: its net rating and its win percentage, each against its own league. Every other stat it was offered carries zero weight.
- Seasons before 1996-97 use ratings, pace and shooting computed from the box score; the NBA's own advanced values exist only from 1996-97.
- Rebound percentages are not used: they cannot be rebuilt from the box score for older seasons.
- No accuracy figure is published for this release.
- The point margin is approximate; typical error on real games was about 11 points.
- Team strength comes from full-season averages, not rosters, injuries, or rest.
```

</details>

## 23. `method-023` (method)

**Question:** Where does the data come from?

**Answer:** The data comes from a public dataset of historical NBA games and box scores, published on Kaggle ("Historical NBA Data and Player Box Scores") [C1].

<details><summary>[C1]</summary>

```text
Where the data comes from
Where the data comes from.
Team box scores and standings come from a public dataset of historical NBA games and box scores, published on Kaggle ("Historical NBA Data and Player Box Scores"). The site builds each team-season's regular-season and playoff profile from it. Champions are taken from the last playoff game of each season. Nothing on the site uses league or team logos or player images, and the site is not affiliated with the NBA or any team.
```

</details>

## 24. `method-024` (method)

**Question:** Is this site affiliated with the NBA?

**Answer:** No, the site is not affiliated with the NBA or any team [C1].

<details><summary>[C1]</summary>

```text
Where the data comes from
Where the data comes from.
Team box scores and standings come from a public dataset of historical NBA games and box scores, published on Kaggle ("Historical NBA Data and Player Box Scores"). The site builds each team-season's regular-season and playoff profile from it. Champions are taken from the last playoff game of each season. Nothing on the site uses league or team logos or player images, and the site is not affiliated with the NBA or any team.
```

</details>

## 25. `multihop-006` (multihop)

**Question:** How did the '96 Bulls' offensive rating compare with the league average that season?

**Answer:** The 1995–96 Chicago Bulls' offensive rating was 114.3 [F1], which is higher than the league average of 107.0 [C2].

<details><summary>[F1]</summary>

```text
1995–96 Chicago Bulls (1996-bulls): 72–10 (.878 win %), the best record of 29 teams. Won the 1995–96 NBA championship, going 15–3 in the playoffs. 105.2 points per game, 92.9 allowed. Against its 1995–96 league: net rating +13.3 per 100 possessions (z +2.3, 1st of 29); offensive rating 114.3 (z +2.0, 1st of 29); defensive rating 101.1, lower is better (z -2.0, 1st of 29); pace 91.8 (z -0.2, 19th fastest of 29); true shooting .556 (z +0.7, 9th of 29); effective field goal % .518 (z +0.9, 4th of 29); three-point % .403 (z +1.7, 3rd of 29); opponent effective field goal % .484, lower is better (z -1.0, 6th of 29); turnover % 15.0%, lower is better (z -1.2, 4th of 29); forced turnover % 17.8% (z +1.3, 5th of 29); assist % 61.8% (z +0.2, 12th of 29). The simulator reads net rating z +2.35 and win % z +2.21. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

<details><summary>[C2]</summary>

```text
1995–96 NBA season
The 1995–96 NBA season (season 1996): 29 teams.
Champion: 1995–96 Chicago Bulls (1996-bulls).
Best record: 1995–96 Chicago Bulls, 72–10.
Best net rating: 1995–96 Chicago Bulls, +13.3.
Worst net rating: 1995–96 Vancouver Grizzlies, -10.8.
League averages (the mean of the 29 teams' figures): offensive rating 107.0, pace 92.4, true shooting .544, three-point % .365, 99.5 points per game.
Ratings and pace for this season are computed from the box score; the NBA's own advanced stats start in 1996–97.
```

</details>

## 26. `multihop-008` (multihop)

**Question:** Which team had the best offence of the 2010s, and did it win the title that season?

**Answer:** The 2016 Golden State Warriors had the best offense of the 2010s, with an offensive rating of 113.5, z +2.5 [C2]. They won the title that season, with a record 73–9 and a best regular-season win % of .890 [C1].

<details><summary>[C1]</summary>

```text
Best regular-season win % (2010s)
Best regular-season win %, the 2010s (2009–10 to 2018–19).
1. 2015–16 Golden State Warriors (2016-warriors): .890; record 73–9.
2. 2014–15 Golden State Warriors (2015-warriors): .817; record 67–15.
3. 2015–16 San Antonio Spurs (2016-spurs): .817; record 67–15.
4. 2016–17 Golden State Warriors (2017-warriors): .817; record 67–15.
5. 2012–13 Miami Heat (2013-heat): .805; record 66–16.
6. 2017–18 Houston Rockets (2018-rockets): .793; record 65–17.
7. 2011–12 Chicago Bulls (2012-bulls): .758; record 50–16.
8. 2011–12 San Antonio Spurs (2012-spurs): .758; record 50–16.
9. 2010–11 Chicago Bulls (2011-bulls): .756; record 62–20.
10. 2013–14 San Antonio Spurs (2014-spurs): .756; record 62–20.
```

</details>

<details><summary>[C2]</summary>

```text
Best offensive rating (2010s)
Best offensive rating, the 2010s (2009–10 to 2018–19). Ranked by z-score against each team's own league, so teams from different eras compare fairly.
1. 2015–16 Golden State Warriors (2016-warriors): 113.5, z +2.5; record 73–9.
2. 2009–10 Phoenix Suns (2010-suns): 114.0, z +2.1; record 54–28.
3. 2015–16 Oklahoma City Thunder (2016-thunder): 112.2, z +2.1; record 55–27.
4. 2016–17 Golden State Warriors (2017-warriors): 114.8, z +2.1; record 67–15.
5. 2011–12 San Antonio Spurs (2012-spurs): 110.0, z +2.0; record 50–16.
6. 2017–18 Houston Rockets (2018-rockets): 114.0, z +2.0; record 65–17.
7. 2012–13 Miami Heat (2013-heat): 111.5, z +2.0; record 66–16.
8. 2012–13 Oklahoma City Thunder (2013-thunder): 111.1, z +1.9; record 60–22.
9. 2016–17 Houston Rockets (2017-rockets): 114.1, z +1.8; record 55–27.
10. 2014–15 Los Angeles Clippers (2015-clippers): 111.6, z +1.8; record 56–26.
```

</details>

## 27. `multihop-012` (multihop)

**Question:** Why might the '86 Celtics' ratings be less precise than the '17 Warriors'?

**Answer:** The '86 Celtics' ratings might be less precise than the '17 Warriors' because the NBA's own advanced stats start in 1996–97, and the simulator reads ratings, pace, and shooting from the box score for the 1985–86 season, whereas it reads the same stats from the box score for the 2016–17 season, which is more comparable to the NBA's own advanced stats [C3].

<details><summary>[F1]</summary>

```text
On a neutral court the simulator gives the 2016–17 Golden State Warriors a 54.4% chance against the 1985–86 Boston Celtics (45.6% for the 1985–86 Boston Celtics), with an estimated margin of about 2 points. It is an estimate for a matchup that never happened.
```

</details>

<details><summary>[F2]</summary>

```text
Why: the simulator reads two numbers per team, each as a z-score against the team's own league. net rating (z +2.20 for the 1985–86 Boston Celtics, +2.67 for the 2016–17 Golden State Warriors) accounts for 92% of the model's lean and favours the 2016–17 Golden State Warriors; win % (z +2.21 for the 1985–86 Boston Celtics, +2.32 for the 2016–17 Golden State Warriors) accounts for 8% of the model's lean and favours the 2016–17 Golden State Warriors. Every other stat carries zero weight.
```

</details>

<details><summary>[F3]</summary>

```text
1985–86 Boston Celtics (1986-celtics): 67–15 (.817 win %), the best record of 23 teams. Won the 1985–86 NBA championship, going 15–3 in the playoffs. 114.1 points per game, 104.7 allowed. Against its 1985–86 league: net rating +9.1 per 100 possessions (z +2.2, 1st of 23); offensive rating 111.0 (z +1.4, 3rd of 23); defensive rating 101.8, lower is better (z -1.7, 2nd of 23); pace 102.0 (z -0.4, 16th fastest of 23); true shooting .565 (z +1.5, 2nd of 23); effective field goal % .519 (z +1.6, 2nd of 23); three-point % .351 (z +1.5, 1st of 23); opponent effective field goal % .467, lower is better (z -1.8, 1st of 23); turnover % 15.7%, lower is better (z -0.9, 5th of 23); forced turnover % 14.5% (z -1.8, 23rd of 23); assist % 63.9% (z +1.2, 3rd of 23). The simulator reads net rating z +2.20 and win % z +2.21. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

<details><summary>[F4]</summary>

```text
2016–17 Golden State Warriors (2017-warriors): 67–15 (.817 win %), the best record of 30 teams. Won the 2016–17 NBA championship, going 16–1 in the playoffs. 115.9 points per game, 104.3 allowed. Against its 2016–17 league: net rating +11.4 per 100 possessions (z +2.7, 1st of 30); offensive rating 114.8 (z +2.1, 1st of 30); defensive rating 103.4, lower is better (z -2.0, 2nd of 30); pace 100.4 (z +1.4, 4th fastest of 30); true shooting .599 (z +2.5, 1st of 30); effective field goal % .565 (z +2.6, 1st of 30); three-point % .383 (z +1.4, 3rd of 30); opponent effective field goal % .486, lower is better (z -2.2, 1st of 30); turnover % 14.6%, lower is better (z +0.3, 20th of 30); forced turnover % 15.4% (z +1.1, 4th of 30); assist % 70.3% (z +2.6, 1st of 30). The simulator reads net rating z +2.67 and win % z +2.32.
```

</details>

<details><summary>[C3]</summary>

```text
1985–86 NBA season
The 1985–86 NBA season (season 1986): 23 teams.
Champion: 1985–86 Boston Celtics (1986-celtics).
Best record: 1985–86 Boston Celtics, 67–15.
Best net rating: 1985–86 Boston Celtics, +9.1.
Worst net rating: 1985–86 Los Angeles Clippers, -6.5.
League averages (the mean of the 23 teams' figures): offensive rating 106.3, pace 103.1, true shooting .542, three-point % .269, 110.2 points per game.
Ratings and pace for this season are computed from the box score; the NBA's own advanced stats start in 1996–97.
```

</details>

## 28. `multihop-014` (multihop)

**Question:** Did the 2011-12 Bobcats play a full 82-game season?

**Answer:** No, the 2011-12 Bobcats did not play a full 82-game season, as they played only 66 games, [C5].

<details><summary>[F1]</summary>

```text
2011–12 Charlotte Bobcats (2012-bobcats): 7–59 (.106 win %), the 30th-best record of 30 teams. Missed the 2011–12 playoffs. 87.0 points per game, 100.9 allowed. Against its 2011–12 league: net rating -15.1 per 100 possessions (z -2.9, 30th of 30); offensive rating 94.3 (z -2.9, 30th of 30); defensive rating 109.4, lower is better (z +1.8, 30th of 30); pace 91.9 (z -0.2, 17th fastest of 30); true shooting .484 (z -2.5, 30th of 30); effective field goal % .440 (z -2.6, 30th of 30); three-point % .295 (z -2.4, 30th of 30); opponent effective field goal % .513, lower is better (z +1.4, 28th of 30); turnover % 15.7%, lower is better (z +0.0, 15th of 30); forced turnover % 14.6% (z -0.8, 25th of 30); assist % 60.4% (z +0.8, 8th of 30). The simulator reads net rating z -2.93 and win % z -2.52.
```

</details>

<details><summary>[C5]</summary>

```text
Short seasons
Short seasons.
Four seasons were shorter than 82 games: 1998–99 (50 games, after a lockout), 2011–12 (66 games, after a lockout), 2019–20 (stopped in March 2020 and finished in the bubble, so teams played between 64 and 75 games), and 2020–21 (72 games). Comparisons use win percentage, not raw wins, so those teams are not penalised. A short season is also noisier: a team's averages rest on fewer games.
```

</details>

## 29. `ranking-006` (ranking)

**Question:** Which team forced the most turnovers of the 2000s?

**Answer:** The 2005–06 Charlotte Bobcats forced the most turnovers of the 2000s, with 18.6% of their opponents' possessions resulting in turnovers, and a z-score of +3.2 [C1].

<details><summary>[C1]</summary>

```text
Most forced turnovers (2000s)
Most forced turnovers, the 2000s (1999–00 to 2008–09). Ranked by z-score against each team's own league, so teams from different eras compare fairly.
1. 2005–06 Charlotte Bobcats (2006-bobcats): 18.6%, z +3.2; record 26–56.
2. 2006–07 Golden State Warriors (2007-warriors): 18.5%, z +2.7; record 42–40.
3. 2006–07 Chicago Bulls (2007-bulls): 18.4%, z +2.5; record 49–33.
4. 2001–02 Utah Jazz (2002-jazz): 18.1%, z +2.2; record 44–38.
5. 2007–08 Boston Celtics (2008-celtics): 17.3%, z +2.1; record 66–16.
6. 2008–09 Milwaukee Bucks (2009-bucks): 17.4%, z +2.1; record 34–48.
7. 2002–03 Denver Nuggets (2003-nuggets): 18.5%, z +2.1; record 17–65.
8. 2007–08 Philadelphia 76ers (2008-76ers): 17.1%, z +1.9; record 40–42.
9. 2000–01 Phoenix Suns (2001-suns): 18.4%, z +1.9; record 51–31.
10. 1999–00 Philadelphia 76ers (2000-76ers): 18.6%, z +1.8; record 49–33.
```

</details>

## 30. `ranking-010` (ranking)

**Question:** Which team had the best net rating since 1985-86, relative to its league?

**Answer:** The 1985–86 Boston Celtics had the best net rating since 1985–86, relative to its league, with a net rating of +9.1 per 100 possessions [C2].

<details><summary>[C2]</summary>

```text
1985–86 Boston Celtics
1985–86 Boston Celtics (1986-celtics).
Regular season 1985–86: 67–15 (.817 win %), the best record of 23 teams.
Won the 1985–86 NBA championship, going 15–3 in the playoffs.
Scoring: 114.1 points per game, 104.7 allowed.
Compared with the 1985–86 league. z is the number of standard deviations from that season's league average; the rank is among its 23 teams.
- Net rating: +9.1 per 100 possessions (z +2.2, better than average; 1st).
- Offensive rating: 111.0 scored per 100 possessions (z +1.4, better than average; 3rd).
- Defensive rating: 101.8 allowed per 100 possessions, lower is better (z -1.7, better than average; 2nd).
- Pace: 102.0 possessions per 48 minutes (z -0.4, slower than average; 16th fastest).
- True shooting: .565 (z +1.5, better than average; 2nd).
- Effective field goal %: .519 (z +1.6, better than average; 2nd).
- Three-point %: .351 (z +1.5, better than average; 1st).
- Opponent effective field goal %: .467, lower is better (z -1.8, better than average; 1st).
- Turnover %: 15.7% of possessions, lower is better (z -0.9, better than average; 5th).
- Forced turnover %: 14.5% of opponent possessions (z -1.8, worse than average; 23rd).
- Assist %: 63.9% of field goals assisted (z +1.2, better than average; 3rd).
Note: the NBA's own advanced stats start in 1996–97, so this season's ratings, pace and shooting figures are computed from the box score.
What the simulator reads for this team: net rating z +2.20 and win % z +2.21. Every other stat carries zero weight in hist-v2.
```

</details>

## 31. `ranking-011` (ranking)

**Question:** Who had the best offence in the late 80s, adjusted for era?

**Answer:** The 1987-88 Boston Celtics had the best offence in the late 1980s, adjusted for era, with an offensive rating of 114.3 [C2].

<details><summary>[C2]</summary>

```text
Best offensive rating (1980s)
Best offensive rating, the 1986s (1985–86 to 1988–89). Ranked by z-score against each team's own league, so teams from different eras compare fairly.
1. 1987–88 Boston Celtics (1988-celtics): 114.3, z +2.0; record 57–25.
2. 1986–87 Los Angeles Lakers (1987-lakers): 114.1, z +1.9; record 65–17.
3. 1986–87 Dallas Mavericks (1987-mavericks): 113.7, z +1.8; record 55–27.
4. 1985–86 Los Angeles Lakers (1986-lakers): 112.2, z +1.8; record 62–20.
5. 1985–86 Dallas Mavericks (1986-mavericks): 111.4, z +1.5; record 44–38.
6. 1988–89 Los Angeles Lakers (1989-lakers): 112.6, z +1.4; record 57–25.
7. 1986–87 Boston Celtics (1987-celtics): 112.3, z +1.4; record 59–23.
8. 1985–86 Boston Celtics (1986-celtics): 111.0, z +1.4; record 67–15.
9. 1988–89 Philadelphia 76ers (1989-76ers): 112.2, z +1.3; record 46–36.
10. 1987–88 Los Angeles Lakers (1988-lakers): 111.7, z +1.3; record 62–20.
```

</details>

## 32. `ranking-018` (ranking)

**Question:** Which team played the slowest of the 1990s?

**Answer:** The 1995–96 Cleveland Cavaliers played the slowest of the 1990s, with a pace of 82.6 points per game and a z-score of -3.7, from [C1].

<details><summary>[C1]</summary>

```text
Slowest pace (1990s)
Slowest pace, the 1990s (1989–90 to 1998–99). Ranked by z-score against each team's own league, so teams from different eras compare fairly.
1. 1995–96 Cleveland Cavaliers (1996-cavaliers): 82.6, z -3.7; record 47–35.
2. 1994–95 Cleveland Cavaliers (1995-cavaliers): 85.3, z -3.2; record 43–39.
3. 1996–97 Cleveland Cavaliers (1997-cavaliers): 84.3, z -2.7; record 42–40.
4. 1993–94 San Antonio Spurs (1994-spurs): 90.7, z -2.2; record 55–27.
5. 1989–90 Minnesota Timberwolves (1990-timberwolves): 92.1, z -2.0; record 22–60.
6. 1996–97 Detroit Pistons (1997-pistons): 86.1, z -2.0; record 54–28.
7. 1992–93 Chicago Bulls (1993-bulls): 93.2, z -1.8; record 57–25.
8. 1998–99 Miami Heat (1999-heat): 86.4, z -1.8; record 33–17.
9. 1997–98 Orlando Magic (1998-magic): 88.5, z -1.8; record 41–41.
10. 1991–92 Detroit Pistons (1992-pistons): 92.8, z -1.8; record 48–34.
```

</details>

## 33. `ranking-021` (ranking)

**Question:** Who was the best three-point shooting team of all time?

**Answer:** The 2015–16 Golden State Warriors (2016-warriors) had the best three-point % of all time, with .415, z +3.5, and a record of 73–9 [C3].

<details><summary>[C3]</summary>

```text
Best three-point % (all-time)
Best three-point %, all seasons, 1985–86 to 2025–26. Ranked by z-score against each team's own league, so teams from different eras compare fairly.
1. 2015–16 Golden State Warriors (2016-warriors): .415, z +3.5; record 73–9.
2. 2003–04 Sacramento Kings (2004-kings): .401, z +3.1; record 55–27.
3. 2009–10 Phoenix Suns (2010-suns): .412, z +3.1; record 54–28.
4. 1996–97 Charlotte Hornets (1997-hornets): .428, z +3.0; record 54–28.
5. 2025–26 Denver Nuggets (2026-nuggets): .396, z +2.7; record 54–28.
6. 2014–15 Golden State Warriors (2015-warriors): .398, z +2.7; record 67–15.
7. 2006–07 Phoenix Suns (2007-suns): .400, z +2.7; record 61–21.
8. 2017–18 Golden State Warriors (2018-warriors): .391, z +2.6; record 58–24.
9. 2020–21 Los Angeles Clippers (2021-clippers): .411, z +2.4; record 47–25.
10. 2018–19 San Antonio Spurs (2019-spurs): .392, z +2.4; record 48–34.
```

</details>

## 34. `ranking-025` (ranking)

**Question:** Who had the best regular-season record of the 1990s?

**Answer:** The 1995–96 Chicago Bulls had the best regular-season record of the 1990s, with a record of 72–10, [C2].

<details><summary>[C2]</summary>

```text
Best regular-season win % (1990s)
Best regular-season win %, the 1990s (1989–90 to 1998–99).
1. 1995–96 Chicago Bulls (1996-bulls): .878; record 72–10.
2. 1996–97 Chicago Bulls (1997-bulls): .842; record 69–13.
3. 1991–92 Chicago Bulls (1992-bulls): .817; record 67–15.
4. 1995–96 Seattle SuperSonics (1996-supersonics): .780; record 64–18.
5. 1996–97 Utah Jazz (1997-jazz): .780; record 64–18.
6. 1989–90 Los Angeles Lakers (1990-lakers): .768; record 63–19.
7. 1990–91 Portland Trail Blazers (1991-trail-blazers): .768; record 63–19.
8. 1993–94 Seattle SuperSonics (1994-supersonics): .768; record 63–19.
9. 1992–93 Phoenix Suns (1993-suns): .756; record 62–20.
10. 1994–95 San Antonio Spurs (1995-spurs): .756; record 62–20.
```

</details>

## 35. `season-001` (season)

**Question:** What was the league's average pace in 1985–86?

**Answer:** The league's average pace in 1985–86 was 103.1 possessions per 48 minutes [C1].

<details><summary>[F1]</summary>

```text
The 1985–86 season (23 teams): champion 1985–86 Boston Celtics; best record 1985–86 Boston Celtics, 67–15; best net rating 1985–86 Boston Celtics, +9.1; worst net rating 1985–86 Los Angeles Clippers, -6.5. League averages: offensive rating 106.3, pace 103.1, true shooting .542, three-point % .269, 110.2 points per game. Ratings and pace this season are computed from the box score.
```

</details>

<details><summary>[C1]</summary>

```text
1985–86 NBA season
The 1985–86 NBA season (season 1986): 23 teams.
Champion: 1985–86 Boston Celtics (1986-celtics).
Best record: 1985–86 Boston Celtics, 67–15.
Best net rating: 1985–86 Boston Celtics, +9.1.
Worst net rating: 1985–86 Los Angeles Clippers, -6.5.
League averages (the mean of the 23 teams' figures): offensive rating 106.3, pace 103.1, true shooting .542, three-point % .269, 110.2 points per game.
Ratings and pace for this season are computed from the box score; the NBA's own advanced stats start in 1996–97.
```

</details>

## 36. `season-004` (season)

**Question:** Who was the worst team by net rating in 1988–89?

**Answer:** The 1988–89 Miami Heat had the worst net rating, -11.1, [C1]. The 1988–89 Miami Heat also had the worst regular-season win percentage, .183, [C2].

<details><summary>[F1]</summary>

```text
The 1988–89 season (25 teams): champion 1988–89 Detroit Pistons; best record 1988–89 Detroit Pistons, 63–19; best net rating 1988–89 Cleveland Cavaliers, +7.5; worst net rating 1988–89 Miami Heat, -11.1. League averages: offensive rating 106.6, pace 101.9, true shooting .538, three-point % .311, 109.2 points per game. Ratings and pace this season are computed from the box score.
```

</details>

<details><summary>[C1]</summary>

```text
1988–89 NBA season
The 1988–89 NBA season (season 1989): 25 teams.
Champion: 1988–89 Detroit Pistons (1989-pistons).
Best record: 1988–89 Detroit Pistons, 63–19.
Best net rating: 1988–89 Cleveland Cavaliers, +7.5.
Worst net rating: 1988–89 Miami Heat, -11.1.
League averages (the mean of the 25 teams' figures): offensive rating 106.6, pace 101.9, true shooting .538, three-point % .311, 109.2 points per game.
Ratings and pace for this season are computed from the box score; the NBA's own advanced stats start in 1996–97.
```

</details>

<details><summary>[C2]</summary>

```text
Worst regular-season win % (1980s)
Worst regular-season win %, the 1986s (1985–86 to 1988–89).
1. 1986–87 Los Angeles Clippers (1987-clippers): .146; record 12–70.
2. 1988–89 Miami Heat (1989-heat): .183; record 15–67.
3. 1987–88 Los Angeles Clippers (1988-clippers): .207; record 17–65.
4. 1987–88 New Jersey Nets (1988-nets): .232; record 19–63.
5. 1987–88 Golden State Warriors (1988-warriors): .244; record 20–62.
6. 1988–89 Charlotte Hornets (1989-hornets): .244; record 20–62.
7. 1988–89 Los Angeles Clippers (1989-clippers): .256; record 21–61.
8. 1988–89 San Antonio Spurs (1989-spurs): .256; record 21–61.
9. 1985–86 New York Knicks (1986-knicks): .281; record 23–59.
10. 1986–87 New York Knicks (1987-knicks): .293; record 24–58.
```

</details>

## 37. `season-012` (season)

**Question:** What was the league's average pace in the 2014 season?

**Answer:** The league's average pace in the 2013-14 season was 94.8 possessions per 48 minutes [C3].

<details><summary>[F1]</summary>

```text
The 2013–14 season (30 teams): champion 2013–14 San Antonio Spurs; best record 2013–14 San Antonio Spurs, 62–20; best net rating 2013–14 San Antonio Spurs, +8.2; worst net rating 2013–14 Philadelphia 76ers, -10.0. League averages: offensive rating 105.7, pace 94.8, true shooting .542, three-point % .359, 101.0 points per game.
```

</details>

<details><summary>[C3]</summary>

```text
2013–14 NBA season
The 2013–14 NBA season (season 2014): 30 teams.
Champion: 2013–14 San Antonio Spurs (2014-spurs).
Best record: 2013–14 San Antonio Spurs, 62–20.
Best net rating: 2013–14 San Antonio Spurs, +8.2.
Worst net rating: 2013–14 Philadelphia 76ers, -10.0.
League averages (the mean of the 30 teams' figures): offensive rating 105.7, pace 94.8, true shooting .542, three-point % .359, 101.0 points per game.
```

</details>

## 38. `season-019` (season)

**Question:** What was the league's average pace in 2024–25?

**Answer:** The league's average pace in 2024–25 was 99.6 possessions per 48 minutes [F1].

<details><summary>[F1]</summary>

```text
The 2024–25 season (30 teams): champion 2024–25 Oklahoma City Thunder; best record 2024–25 Oklahoma City Thunder, 68–14; best net rating 2024–25 Oklahoma City Thunder, +12.6; worst net rating 2024–25 Washington Wizards, -12.2. League averages: offensive rating 113.8, pace 99.6, true shooting .577, three-point % .360, 113.7 points per game.
```

</details>

## 39. `stat-007` (stat)

**Question:** What was the net rating of the 1988–89 Los Angeles Lakers?

**Answer:** The net rating of the 1988–89 Los Angeles Lakers was +6.9 per 100 possessions, z +1.3 [F1].

<details><summary>[F1]</summary>

```text
1988–89 Los Angeles Lakers (1989-lakers): 57–25 (.695 win %), the 2nd-best record of 25 teams. Made the 1988–89 playoffs and went 11–4 in them; did not win the title. 114.7 points per game, 107.5 allowed. Against its 1988–89 league: net rating +6.9 per 100 possessions (z +1.3, 3rd of 25); offensive rating 112.6 (z +1.4, 1st of 25); defensive rating 105.7, lower is better (z -0.4, 7th of 25); pace 101.2 (z -0.2, 13th fastest of 25); true shooting .571 (z +1.8, 1st of 25); effective field goal % .519 (z +1.8, 1st of 25); three-point % .340 (z +0.7, 5th of 25); opponent effective field goal % .485, lower is better (z -0.4, 9th of 25); turnover % 15.8%, lower is better (z -0.4, 9th of 25); forced turnover % 14.6% (z -1.2, 22nd of 25); assist % 63.3% (z +0.9, 5th of 25). The simulator reads net rating z +1.28 and win % z +1.20. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

## 40. `stat-013` (stat)

**Question:** What was the defensive rating of the Jazz 1997?

**Answer:** The defensive rating of the 1996–97 Utah Jazz was 102.7, lower is better [F1].

<details><summary>[F1]</summary>

```text
1996–97 Utah Jazz (1997-jazz): 64–18 (.780 win %), the 2nd-best record of 29 teams. Made the 1996–97 playoffs and went 13–7 in them; did not win the title. 103.1 points per game, 94.3 allowed. Against its 1996–97 league: net rating +9.7 per 100 possessions (z +1.7, 2nd of 29); offensive rating 112.5 (z +2.3, 1st of 29); defensive rating 102.7, lower is better (z -0.6, 9th of 29); pace 91.1 (z -0.2, 18th fastest of 29); true shooting .582 (z +2.4, 1st of 29); effective field goal % .532 (z +2.1, 1st of 29); three-point % .370 (z +0.5, 8th of 29); opponent effective field goal % .482, lower is better (z -0.7, 9th of 29); turnover % 16.7%, lower is better (z -0.2, 10th of 29); forced turnover % 17.6% (z +0.6, 7th of 29); assist % 70.2% (z +2.2, 1st of 29). The simulator reads net rating z +1.67 and win % z +1.47.
```

</details>

## 41. `stat-016` (stat)

**Question:** How many points per 100 possessions did the 2002–03 Sacramento Kings allow?

**Answer:** The 2002–03 Sacramento Kings allowed 97.7 points per 100 possessions [F1].

<details><summary>[F1]</summary>

```text
2002–03 Sacramento Kings (2003-kings): 59–23 (.720 win %), the 3rd-best record of 29 teams. Made the 2002–03 playoffs and went 7–5 in them; did not win the title. 101.7 points per game, 95.2 allowed. Against its 2002–03 league: net rating +6.8 per 100 possessions (z +1.5, 2nd of 29); offensive rating 104.4 (z +0.6, 6th of 29); defensive rating 97.7, lower is better (z -1.6, 2nd of 29); pace 96.6 (z +2.1, 1st fastest of 29); true shooting .536 (z +0.9, 5th of 29); effective field goal % .500 (z +1.5, 2nd of 29); three-point % .381 (z +1.4, 4th of 29); opponent effective field goal % .447, lower is better (z -2.3, 1st of 29); turnover % 14.9%, lower is better (z -0.7, 6th of 29); forced turnover % 15.8% (z -0.1, 15th of 29); assist % 62.8% (z +0.7, 6th of 29). The simulator reads net rating z +1.50 and win % z +1.52.
```

</details>

## 42. `stat-017` (stat)

**Question:** How many points per 100 possessions did the Bulls 2018 score?

**Answer:** The 2017–18 Chicago Bulls scored 102.9 points per game, which is equivalent to 102.9 points per 100 possessions, [F1].

<details><summary>[F1]</summary>

```text
2017–18 Chicago Bulls (2018-bulls): 27–55 (.329 win %), the 24th-best record of 30 teams. Missed the 2017–18 playoffs. 102.9 points per game, 110.0 allowed. Against its 2017–18 league: net rating -7.1 per 100 possessions (z -1.6, 28th of 30); offensive rating 103.4 (z -1.4, 28th of 30); defensive rating 110.5, lower is better (z +1.1, 28th of 30); pace 98.6 (z +0.4, 11th fastest of 30); true shooting .530 (z -1.6, 29th of 30); effective field goal % .498 (z -1.4, 29th of 30); three-point % .355 (z -0.6, 21st of 30); opponent effective field goal % .543, lower is better (z +1.5, 29th of 30); turnover % 14.1%, lower is better (z -0.4, 11th of 30); forced turnover % 13.6% (z -0.9, 25th of 30); assist % 60.7% (z +0.6, 8th of 30). The simulator reads net rating z -1.60 and win % z -1.15.
```

</details>

## 43. `stat-022` (stat)

**Question:** How efficiently did the 2016 Cavaliers shoot?

**Answer:** The 2016 Cavaliers had a true shooting percentage of .559, which is a z-score of +1.0 against their own league [F1].

<details><summary>[F1]</summary>

```text
2015–16 Cleveland Cavaliers (2016-cavaliers): 57–25 (.695 win %), the 3rd-best record of 30 teams. Won the 2015–16 NBA championship, going 16–5 in the playoffs. 104.3 points per game, 98.3 allowed. Against its 2015–16 league: net rating +6.3 per 100 possessions (z +1.2, 4th of 30); offensive rating 110.4 (z +1.5, 3rd of 30); defensive rating 104.0, lower is better (z -0.5, 10th of 30); pace 93.8 (z -1.3, 28th fastest of 30); true shooting .559 (z +1.0, 4th of 30); effective field goal % .526 (z +1.2, 3rd of 30); three-point % .362 (z +0.5, 7th of 30); opponent effective field goal % .498, lower is better (z -0.4, 13th of 30); turnover % 14.3%, lower is better (z -0.4, 13th of 30); forced turnover % 14.1% (z -0.5, 21st of 30); assist % 58.6% (z +0.1, 17th of 30). The simulator reads net rating z +1.20 and win % z +1.15.
```

</details>

## 44. `stat-030` (stat)

**Question:** What record did the '92 Timberwolves finish with?

**Answer:** The 1991–92 Minnesota Timberwolves finished with a record of 15–67, [F1].

<details><summary>[F1]</summary>

```text
1991–92 Minnesota Timberwolves (1992-timberwolves): 15–67 (.183 win %), the 27th-best record of 27 teams. Missed the 1991–92 playoffs. 100.5 points per game, 107.5 allowed. Against its 1991–92 league: net rating -7.2 per 100 possessions (z -1.4, 25th of 27); offensive rating 103.9 (z -0.9, 22nd of 27); defensive rating 111.1, lower is better (z +1.6, 27th of 27); pace 96.1 (z -0.6, 19th fastest of 27); true shooting .506 (z -1.3, 25th of 27); effective field goal % .469 (z -1.1, 24th of 27); three-point % .320 (z -0.2, 16th of 27); opponent effective field goal % .499, lower is better (z +0.8, 22nd of 27); turnover % 13.9%, lower is better (z -1.3, 4th of 27); forced turnover % 14.8% (z -0.5, 19th of 27); assist % 60.1% (z +0.2, 12th of 27). The simulator reads net rating z -1.42 and win % z -1.99. Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996–97).
```

</details>

## 45. `stat-031` (stat)

**Question:** How well did the 2008–09 Los Angeles Lakers shoot from three?

**Answer:** Sorry, I can't answer that from the site's data.

<details><summary>[F1]</summary>

```text
2008–09 Los Angeles Lakers (2009-lakers): 65–17 (.793 win %), the 2nd-best record of 30 teams. Won the 2008–09 NBA championship, going 16–7 in the playoffs. 106.9 points per game, 99.3 allowed. Against its 2008–09 league: net rating +7.9 per 100 possessions (z +1.6, 2nd of 30); offensive rating 111.3 (z +1.5, 3rd of 30); defensive rating 103.4, lower is better (z -1.1, 5th of 30); pace 95.5 (z +0.9, 5th fastest of 30); true shooting .556 (z +0.7, 6th of 30); effective field goal % .514 (z +0.8, 5th of 30); three-point % .361 (z -0.3, 19th of 30); opponent effective field goal % .491, lower is better (z -0.6, 8th of 30); turnover % 14.0%, lower is better (z -0.9, 5th of 30); forced turnover % 16.2% (z +1.1, 5th of 30); assist % 57.6% (z +0.4, 8th of 30). The simulator reads net rating z +1.56 and win % z +1.70.
```

</details>

## 46. `stat-033` (stat)

**Question:** What was the offensive rating of the 2010–11 Washington Wizards?

**Answer:** The 2010–11 Washington Wizards had an offensive rating of 101.3 [F1].

<details><summary>[F1]</summary>

```text
2010–11 Washington Wizards (2011-wizards): 23–59 (.281 win %), the 27th-best record of 30 teams. Missed the 2010–11 playoffs. 97.3 points per game, 104.7 allowed. Against its 2010–11 league: net rating -7.8 per 100 possessions (z -1.6, 29th of 30); offensive rating 101.3 (z -1.6, 29th of 30); defensive rating 109.1, lower is better (z +0.8, 24th of 30); pace 94.8 (z +0.8, 9th fastest of 30); true shooting .514 (z -1.6, 29th of 30); effective field goal % .471 (z -1.6, 29th of 30); three-point % .332 (z -1.3, 28th of 30); opponent effective field goal % .513, lower is better (z +0.8, 24th of 30); turnover % 16.0%, lower is better (z +0.8, 24th of 30); forced turnover % 16.4% (z +1.1, 6th of 30); assist % 52.1% (z -1.7, 30th of 30). The simulator reads net rating z -1.57 and win % z -1.37.
```

</details>

## 47. `stat-048` (stat)

**Question:** What was the defensive rating of the 2002–03 Los Angeles Clippers?

**Answer:** The 2002–03 Los Angeles Clippers had a defensive rating of 105.0, lower is better, with a z-score of +1.0, [F1].

<details><summary>[F1]</summary>

```text
2002–03 Los Angeles Clippers (2003-clippers): 27–55 (.329 win %), the 25th-best record of 29 teams. Missed the 2002–03 playoffs. 93.8 points per game, 97.9 allowed. Against its 2002–03 league: net rating -4.0 per 100 possessions (z -0.9, 24th of 29); offensive rating 101.0 (z -0.3, 22nd of 29); defensive rating 105.0, lower is better (z +1.0, 25th of 29); pace 92.7 (z +0.2, 13th fastest of 29); true shooting .517 (z -0.2, 19th of 29); effective field goal % .468 (z -0.4, 22nd of 29); three-point % .331 (z -0.6, 23rd of 29); opponent effective field goal % .482, lower is better (z +0.6, 19th of 29); turnover % 16.9%, lower is better (z +0.6, 22nd of 29); forced turnover % 15.1% (z -0.8, 23rd of 29); assist % 56.6% (z -0.9, 24th of 29). The simulator reads net rating z -0.89 and win % z -1.18.
```

</details>

## 48. `stat-050` (stat)

**Question:** What was the defensive rating of the Lakers 2002?

**Answer:** The defensive rating of the 2001–02 Los Angeles Lakers was 100.5, lower is better (z -0.9, 7th of 29) [F1].

<details><summary>[F1]</summary>

```text
2001–02 Los Angeles Lakers (2002-lakers): 58–24 (.707 win %), the 2nd-best record of 29 teams. Won the 2001–02 NBA championship, going 15–4 in the playoffs. 101.3 points per game, 94.2 allowed. Against its 2001–02 league: net rating +7.6 per 100 possessions (z +1.7, 2nd of 29); offensive rating 108.1 (z +1.5, 2nd of 29); defensive rating 100.5, lower is better (z -0.9, 7th of 29); pace 93.3 (z +0.7, 6th fastest of 29); true shooting .534 (z +0.8, 8th of 29); effective field goal % .498 (z +1.2, 4th of 29); three-point % .354 (z +0.1, 13th of 29); opponent effective field goal % .455, lower is better (z -1.8, 2nd of 29); turnover % 13.5%, lower is better (z -1.8, 2nd of 29); forced turnover % 14.9% (z -0.6, 21st of 29); assist % 59.7% (z -0.3, 18th of 29). The simulator reads net rating z +1.68 and win % z +1.50.
```

</details>

## 49. `stat-051` (stat)

**Question:** How many points per 100 possessions did the 2018–19 Toronto Raptors score?

**Answer:** The 2018–19 Toronto Raptors scored 112.7 points per 100 possessions [F1].

<details><summary>[F1]</summary>

```text
2018–19 Toronto Raptors (2019-raptors): 58–24 (.707 win %), the 2nd-best record of 30 teams. Won the 2018–19 NBA championship, going 16–8 in the playoffs. 114.4 points per game, 108.3 allowed. Against its 2018–19 league: net rating +5.7 per 100 possessions (z +1.2, 3rd of 30); offensive rating 112.7 (z +1.0, 5th of 30); defensive rating 107.0, lower is better (z -1.0, 5th of 30); pace 100.5 (z -0.1, 15th fastest of 30); true shooting .582 (z +1.4, 3rd of 30); effective field goal % .546 (z +1.4, 3rd of 30); three-point % .366 (z +0.7, 6th of 30); opponent effective field goal % .509, lower is better (z -1.1, 4th of 30); turnover % 13.8%, lower is better (z -0.1, 13th of 30); forced turnover % 14.7% (z +0.7, 9th of 30); assist % 60.2% (z +0.1, 14th of 30). The simulator reads net rating z +1.19 and win % z +1.41.
```

</details>

## 50. `stat-052` (stat)

**Question:** What was the defensive rating of the 1999-00 Lakers?

**Answer:** The defensive rating of the 1999–00 Los Angeles Lakers was 96.5, lower is better (z -1.9, 1st of 29) [F1].

<details><summary>[F1]</summary>

```text
1999–00 Los Angeles Lakers (2000-lakers): 67–15 (.817 win %), the best record of 29 teams. Won the 1999–00 NBA championship, going 15–8 in the playoffs. 100.8 points per game, 92.3 allowed. Against its 1999–00 league: net rating +8.9 per 100 possessions (z +1.8, 1st of 29); offensive rating 105.4 (z +1.0, 5th of 29); defensive rating 96.5, lower is better (z -1.9, 1st of 29); pace 95.0 (z +0.2, 13th fastest of 29); true shooting .526 (z +0.1, 15th of 29); effective field goal % .485 (z +0.4, 14th of 29); three-point % .329 (z -1.1, 25th of 29); opponent effective field goal % .444, lower is better (z -2.1, 1st of 29); turnover % 14.5%, lower is better (z -1.2, 3rd of 29); forced turnover % 15.2% (z -0.8, 24th of 29); assist % 61.2% (z +0.1, 13th of 29). The simulator reads net rating z +1.80 and win % z +1.97.
```

</details>
