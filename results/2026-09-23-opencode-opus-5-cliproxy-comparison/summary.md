# Benchmark summary

## chess-bugfix

| | Routing on | Routing off (baseline) |
| --- | ---: | ---: |
| Runs | 5 | 5 |
| Solved (every check passed) | 100% | 100% |
| Checks passed, median | 100% (+0%) | 100% |
| LLM requests, median | 13 (-28%) | 18 |
| Input tokens, median | 542,756 (-32%) | 800,493 |
| …of which cached | 83% | 92% |
| Output tokens, median | 9,010 (-62%) | 23,807 |
| …of which reasoning | 0 | 0 |
| Wall-clock seconds, median | 130.1 (-79%) | 623.3 |
| Jev calls, median | 12 | 0 |
| Requests Jev steered | 33% | 0% |
| Failed LLM requests, total | 0 | 1 |
| Agent timeouts | 0 | 0 |

## chess-san

| | Routing on | Routing off (baseline) |
| --- | ---: | ---: |
| Runs | 5 | 5 |
| Solved (every check passed) | 100% | 100% |
| Checks passed, median | 100% (+0%) | 100% |
| LLM requests, median | 25 (-4%) | 26 |
| Input tokens, median | 1,242,986 (-5%) | 1,302,382 |
| …of which cached | 91% | 95% |
| Output tokens, median | 19,972 (-29%) | 28,235 |
| …of which reasoning | 0 | 0 |
| Wall-clock seconds, median | 290.9 (-31%) | 422.0 |
| Jev calls, median | 24 | 0 |
| Requests Jev steered | 56% | 0% |
| Failed LLM requests, total | 0 | 0 |
| Agent timeouts | 0 | 0 |

Percentages in brackets compare the routing-on median with the baseline median.
