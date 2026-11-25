# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xiexin111155/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xiexin111155/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. The program reads a sealed DefiLlama snapshot of 758 protocols, sets aside the ones that already record a token (and the wrapped, staked, bridged and exchange products that will never hold a launch of their own), and ranks the remaining pre-token protocols by an implied launch value. The value is derived from the snapshot's own figures only: each category's median FDV/TVL multiple among protocols whose token already trades, the protocol's TVL, its seven-day TVL growth, and how long it has run with no token. Every ranked protocol carries a concrete farm plan with a capital budget, per-step costs and a time window. The dashboard is a static page (board, per-protocol detail view, search and filters) that renders with no network.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fjxzens&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
