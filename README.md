# Find the peak

**Live site:** https://USERNAME.github.io/REPO/ <!-- TODO: replace once GitHub Pages is on -->

A search game that runs entirely in the browser. Somewhere in a square is a peak worth 100. Each turn you place a few points and learn the height at each one. Five search algorithms get the same hidden landscape and the same budget. After the last turn, whoever has found the highest point wins.

Landscapes come in seven families (hills, ridges, craters, terraces, crystals, a mesa with a needle, and Ackley) plus random linear mixes of them, and each favours a different algorithm. In **sonar mode** each search reveals a small circle of the landscape instead of a single point.

By David Cavender, applied mathematics PhD candidate at UC San Diego (optimization, mean field games, multi-agent control). <!-- TODO: add CV / LinkedIn links -->

## The opponents

Placing several points per turn is batch, or multi-agent, search: several searchers working in parallel. The opponents are ordered by how much their searchers share:

| Opponent | What the searchers share | How it picks points |
|---|---|---|
| **Bayesian optimization** | one statistical model of the landscape | Gaussian process (length scale refit each turn by marginal likelihood), upper confidence bound μ + 2σ, batches by kriging believer, μ + 0.5σ on the last turn |
| **Voronoi explorer** | a map of where everyone has searched | scores the vertices of the Voronoi diagram (centres of empty circles) by neighbours' heights + β · radius, greedy batches with placeholder sites, β shrinks each turn |
| **Particle swarm** | the best point found so far | standard PSO with Clerc–Kennedy constriction (0.729, 1.494) |
| **Hill climbers** | nothing | independent (1+1) evolution strategies with step-size adaptation and restarts |
| **Random search** | nothing, not even memory | uniform points |

## No searcher wins everywhere

Average best height found on medium landscapes, 5 searches per turn for 6 turns, 80 seeded landscapes per column (`node tests/benchmark.js 80 medium`). The best in each column is in bold.

| Opponent | Hills | Ridge | Craters | Terraces | Crystal | Mesa | Ackley | Mixes |
|---|---|---|---|---|---|---|---|---|
| Bayesian optimization | **72.0** | 59.4 | 67.3 | 79.1 | **73.2** | 60.6 | 95.3 | **79.6** |
| Voronoi explorer | 71.1 | 59.4 | 65.5 | **81.6** | 71.8 | **61.8** | **97.0** | 76.4 |
| Particle swarm | 67.3 | **65.4** | **71.7** | 72.9 | 71.4 | 59.2 | 88.7 | 74.7 |
| Hill climbers | 63.3 | 64.6 | 64.9 | 73.2 | 63.6 | 60.3 | 80.9 | 71.7 |
| Random search | 60.1 | 58.0 | 61.2 | 68.1 | 63.7 | 60.7 | 77.7 | 69.4 |

Every family has its own winner. Bayesian optimization wins the round hills it models well and loses ridges, where an isotropic kernel can't follow a narrow curved crest. The swarm wins ridges and craters by piling onto a promising crest together. The Voronoi explorer wins terraces, where there is no slope and covering space is all that matters. On the mesa, random search is as good as anything. On random mixes the generalist wins: blending smooths out each family's extremes, which suits Bayesian optimization's smoothness assumption. This is the *no free lunch* theorem in miniature.

**Sonar mode** (`REVEAL=circle node tests/benchmark.js 40 medium`):

| Opponent | Hills | Ridge | Craters | Terraces | Crystal | Mesa | Ackley | Mixes |
|---|---|---|---|---|---|---|---|---|
| Bayesian optimization | **89.6** | **92.7** | 87.5 | 90.5 | 80.4 | **77.0** | 98.7 | **90.6** |
| Voronoi explorer | 70.3 | 80.9 | 84.7 | **91.3** | 82.6 | 70.3 | **100.0** | 87.7 |
| Particle swarm | 77.6 | 84.9 | **91.7** | 85.3 | **83.4** | 66.1 | 98.6 | 88.7 |
| Hill climbers | 79.7 | 82.3 | 82.7 | 82.9 | 79.9 | 76.0 | 89.6 | 81.7 |
| Random search | 76.2 | 75.8 | 82.8 | 72.2 | 76.5 | 75.5 | 82.5 | 81.4 |

Sonar makes everyone better and reshuffles the winners. With a dense patch of samples around every search, Bayesian optimization can now see a ridge's shape and wins it. The hill climbers, who get a free local uphill step from every circle, close most of the gap.

## What I built

- **Seven landscape families**, each a small generator in `js/landscape.js`. Parts are merged with a smooth maximum (log-sum-exp) so decoys can't stack into something taller than the intended peak. *Crystal* is Worley cellular noise, F2 − F1 over a hidden Voronoi diagram, rescaled per cell so each seed's tip has its own height. *Ridge* is the max over a sampled curve of a height that climbs along it. Every landscape is rescaled so the minimum is 0 and the peak is exactly 100. *Random mix* is a linear combination of two or three families (each rescaled to [0, 1], random weights, Ackley's halved), rescaled again. *Surprise me* picks a mix half the time and a single family otherwise, from the seed, and reveals it at the end. Every spot within half a point of the top is marked in the reveal, since a mix can have more than one.
- **Sonar mode:** each search reveals a disc (radius 0.04 / 0.03 / 0.022 by difficulty) and scores the highest point inside it, found by a polar scan plus a pattern search kept inside the disc. You see the disc. Opponents get 19 heights on a fixed polar pattern plus the disc's highest point.
- **A Gaussian process from scratch:** dense Cholesky, profiled marginal likelihood for the signal variance, kriging-believer conditioning. `tests/check_gp.js` checks it against a brute-force solve.
- **The Voronoi diagrams** (your board's nearest-neighbour shading and the Voronoi explorer) use the same from-scratch tessellation as [Crowds on a Voronoi mesh](#). <!-- TODO: link -->
- **Everything is seeded.** Seed, family, difficulty, points per turn, turns and mode replay exactly, including every opponent move. The URL hash holds all of them, so a link shares a game. *Today's landscape* (seed = today's date) is the same for everyone.

There is no backend and there are no dependencies. It's plain JavaScript in classic `<script>` tags, so it also runs from `file://`. The only external request is Google Fonts, and the page falls back to system fonts without it. Your win/loss record is kept in `localStorage` in your own browser.

## Look at it locally

Double-click `index.html`. If a browser complains about local files, run `python -m http.server 8000` in this folder and open http://localhost:8000.

## Put it online

Any static host works. With GitHub Pages: push this folder to a repo, then pick the branch under *Settings → Pages*. Before publishing, replace the `href="#"` links marked `data-todo` in `index.html` (search for `TODO`).

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | Page and drafting-sheet styling (shared look with the crowd site) |
| `js/landscape.js` | The seven landscape families, normalization, contour lines |
| `js/gp.js` | Gaussian process: fit, predict, kriging believer |
| `js/searchers.js` | The five opponents |
| `js/game.js` | One game: turns, scoring, standings, sonar discs |
| `js/view.js` | Boards, standings, chart, record, controls |
| `js/rng.js` | Seeded random numbers, Halton space-filling designs |
| `js/voronoi.js`, `js/colors.js`, `js/chart.js`, `js/ui.js` | Copied unchanged from the crowd site |
| `tests/benchmark.js` | Plays every opponent on every family (the tables above); `REVEAL=circle` for sonar |
| `tests/check_gp.js` | GP vs. dense solve, believer, every family's range and peak, sonar disc max, seeded replay |

## Tuning

- **Difficulty:** `VC.DIFFICULTY` at the top of `js/landscape.js`. Each family reads the dial `s` (0 / 0.5 / 1) in its own generator. Sonar radii are in `VC.SONAR` in `js/game.js`.
- **New families:** add a generator to `GEN` and an entry to `VC.FAMILIES` in `js/landscape.js`. It shows up in the picker, the notes gallery and the benchmark automatically.
- **Opponents:** each class in `js/searchers.js`. If you change them, re-run `node tests/benchmark.js` and update the `BENCH` numbers in `js/view.js` and the table above.
# searchle website
