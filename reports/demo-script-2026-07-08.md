# Demo script draft — 2026-07-08

Target: 60 to 90 seconds, read aloud. Four beats. Hand-drafted; `npm run demo:draft`
regenerates it from the build log.

---

Most agent tools show you a spinner and a wall of logs, and leave you to guess whether you can trust the result. This is a different answer to that.

Here the agent runs a money check-in over a few hundred transactions. Watch it work, one hop at a time. First it gathers the subscriptions. Then it acts, flagging four price increases this quarter, and it writes down its own confidence as it goes. Then it verifies every claim against the raw charges.

Here is the moment it turns on. The agent flagged AWS as a price increase, from twenty-two dollars to sixty-eight. But look at the evidence beside the verdict. The middle charge is forty-one dollars, which is neither the old price nor the new one. That is not a subscription changing price, it is usage-based billing, and the verify step reverses it. The real total drops back to fifteen fifty a month.

The one decision I am proud of: at every hop, the evidence sits next to the verdict. So a claim can be checked against its own data, right at the moment you decide whether to trust it.
