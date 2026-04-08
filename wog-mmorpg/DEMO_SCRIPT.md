# World of Guilds — Demo Script
### Vertex Swarm Challenge 2026 Pitch Video

**Target duration:** 3–5 minutes  
**Format:** Screen recording + voiceover

---

## Setup (do this before recording)

1. Open two terminals side-by-side
2. Start FoxMQ: `./foxmq.exe --allow-anonymous-login --mqtt-addr=127.0.0.1:1883`
3. Start game server: `cd wog-mmorpg/shard && node start.js`
4. Open browser at https://rogue-function.vercel.app/game.html (or localhost:5173/game.html)
5. In a second tab open the contract explorer:
   https://explorer.hiro.so/address/ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property?chain=testnet
6. Optionally open a 3rd tab for aibtc.news correspondent signals

---

## Script

---

### [0:00–0:30] Hook

*Show the live game — agents fighting on the Phaser 2D map*

> "Most AI agent demos are fake. One agent, one task, scripted output.
>
> This is World of Guilds. Three autonomous AI agents operating inside a live MMORPG with real on-chain stakes — and no one is in charge."

*Pause on the combat log — mobs dying, gold numbers flying*

---

### [0:30–1:00] The Economy

*Click the Estate tab in the bottom nav*

> "These agents don't just fight. They invest.
>
> Every property you see here is a real SIP-009 NFT on Stacks testnet — 11 deeds, all minted on-chain."

*Switch to the contract explorer tab — show the 11 tokens*

> "Tier 4 Shadowgate Castle. 120 gold per game tick, passive income, no actions required.
>
> Every agent is trying to own it."

*Switch back to game — show the Estate panel with portfolio*

---

### [1:00–1:45] Leaderless Coordination (the Vertex angle)

*Split screen: terminal showing FoxMQ log + game UI*

> "Here's what makes this a Vertex submission.
>
> There is no central server managing the property market. Every bid, every listing, every distress sale flows through Tashi FoxMQ — a Byzantine fault-tolerant MQTT broker."

*Point to FoxMQ terminal — show `wog/property/list` messages scrolling*

> "When Ragnar and Kira both try to buy the same property at the same tick — FoxMQ consensus ordering picks the winner. Not a coin flip. Not a race condition. The canonical first message in the consensus sequence wins.
>
> Same guarantee a blockchain gives you for transaction ordering — but at millisecond latency."

---

### [1:45–2:30] Distress Auction — the killer feature

*Narrate while letting an agent die in combat (or trigger it manually)*

> "Watch what happens when an agent dies."

*Show agent HP dropping to 0 in the combat log*

> "The moment an agent's HP hits zero, it broadcasts its entire property portfolio at 60% price to every peer on the FoxMQ mesh."

*Point to FoxMQ terminal — show `wog/property/distress` topic firing*

> "Kira was watching for exactly this. She seizes the portfolio before the other agents can respond — no coordinator telling her to, no script. Her personality weights prioritize distress auctions."

*Show Estate panel updating — Kira now owns new properties*

> "The economy just transferred wealth. On-chain. No human involved."

---

### [2:30–3:00] aibtc Correspondent

*Open submitSignals.js briefly, then switch to aibtc.news or the filed_signals.json*

> "The shard is also a registered aibtc.news correspondent.
>
> When the economy generates a notable event — a tier-4 acquisition, a mass liquidation — it files a signal to the Agent Economy beat. Automatically. Via BIP-137 signature.
>
> Autonomous agents generating autonomous financial news."

---

### [3:00–3:30] Wrap

*Return to full game view — all three agents active*

> "World of Guilds is what happens when you give AI agents real stakes.
>
> Real on-chain property. Real passive income. Real P2P negotiation through Vertex consensus.
>
> No master controller. No scripts. Just three agents building wealth — or losing it all in a dungeon."

*Pause on the live leaderboard*

> "The code is open. The contracts are live. The agents are running right now."

---

## Key URLs to show on screen

| Screen moment | URL to display |
|---|---|
| Contract proof | https://explorer.hiro.so/address/ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property?chain=testnet |
| Live game | https://rogue-function.vercel.app/game.html |
| GitHub | https://github.com/githoboman/rogue-function |

---

## Backup: if game server is slow

- Use the production Railway URL: https://rogue-function-production.up.railway.app
- The Estate panel fetches from `/properties` and `/properties/all` — works against production

---

## Talking points for Q&A

**"What makes this different from a regular game bot?"**
> These agents make economic decisions under uncertainty — imperfect information, competing peers, on-chain settlement. They're not playing an optimal strategy; they're playing their *personality*.

**"What's the Vertex angle specifically?"**
> FoxMQ replaces the central game server as the property market authority. No shard process can be bribed or hacked to award a property incorrectly — the consensus layer is the arbiter.

**"Could this work on mainnet?"**
> Yes. The contracts are standard SIP-009/SIP-010 Clarity. The agents already sign real Stacks transactions. The only change is the network flag in `.env`.

**"Does it need Claude API?"**
> No. Fallback AI with personality weights (Ragnar aggressive, Lyria cautious, Kira opportunistic) runs entirely without an API key. The economic behavior is nearly identical.
