# Fleet supervisor — design brief

The experience a human opens to review the work of many agents. This brief fixes the jobs,
the opportunities, and the information architecture before any screen gets designed, so the
three levels read as one system.

## The frame

The supervisor has one scarce resource, attention, and one enemy, false certainty. The
Vincennes argument names the trap precisely: trust gets stored as an attribute of an agent
and then spent on a claim, while the claim's own doubt is stripped on the way up. So the
spine of this design is that trust attaches to the claim, not the agent, and confidence and
evidence stay visible at every level. The measure is time to a trusted decision.

## Jobs to be done

Functional:

1. When I sit down to a queue of overnight agent work, I want to know instantly where my attention is needed, so I spend my limited time only on decisions that change the outcome.
2. When I look at one agent's output, I want its claim, evidence, and confidence in one view, so I can decide whether to trust it without redoing the work.
3. When an agent reports a confident conclusion, I want to see the doubt that existed upstream, so I catch a shaky claim that arrived looking certain.
4. When I doubt an item, I want a cheap way to check it, so verification is not so expensive that I skip it.
5. When most items are safe, I want to clear them in one action and drill into the risky few, so I move volume without rubber-stamping risk.
6. When something went wrong, I want to walk back the chain to the exact hop that failed, so I fix the right place and turn it into a guardrail.

Emotional:

7. When I approve agent work, I want to feel I actually checked what mattered, so I trust the system without dread that I missed something.
8. When volume is high, I want the review to feel finite and calm, so it does not become the bottleneck that cancels the agents' speed.

Social:

9. When I approve or reject, I want a defensible, shareable record of why, so I can justify the call and the fleet inherits what I learned.

## How might we

1. HMW route attention to exactly the items where judgment changes the outcome, and make the safe majority recede?
2. HMW make an agent's confidence and its upstream doubt travel to the top of the review, so nothing arrives falsely certain?
3. HMW put evidence beside every verdict so a claim is checked against its own data in seconds, at any level?
4. HMW make verification cheap enough that the supervisor actually does it?
5. HMW let the supervisor clear the safe majority in one action while still forcing a genuine look at the risky few?
6. HMW show the health of the whole fleet at a glance without burying the one anomaly that matters?
7. HMW attach trust to a claim and its evidence rather than to an agent's reputation?
8. HMW turn every caught failure into a standing guardrail or eval, so the fleet learns?

## The trust object (the spine that travels)

Every claim moves through the system as a small object: the statement, the model's own
confidence verbatim, the evidence behind it, the verification result, and its provenance
(which agent and model produced it). Rolling up to a summary aggregates these into one
signal, but it never discards confidence or evidence. Drilling down always restores the
full object. This is the one rule that defeats confidence-stripping: no level is allowed to
show a verdict without the doubt and the evidence that qualify it.

## Propagation and blast radius (the load-bearing refinement)

The most dangerous item is not the loud failure. It is a claim that looks trivial where it
was made, at low confidence, that gets consumed by a bigger, higher-stakes loop with its
doubt stripped on the way. At its own layer nobody looks, and now a shaky input is
load-bearing in a consequential decision. This is the Vincennes failure at fleet scale.

New job: when a weak agent's conclusion feeds more important loops, I want that surfaced
before it snowballs, so the problem is caught at the source rather than after it moved
upstream.

New HMW: HMW rank an item by its doubt times its downstream stakes, so a shaky claim feeding
a consequential loop rises above a confident claim that nothing depends on?

Three mechanics follow:

1. Trust cannot be scored only locally. Triage rank is roughly doubt times downstream
   stakes, so load-bearing uncertainty floats to the top even when it looked harmless in
   isolation. This requires the system to know the dependency graph between claims.
2. Provenance must run forward, not only backward. Today a claim knows who produced it; it
   also needs to know what it went on to affect, so the fleet view can show a forward
   lineage and compute exposure.
3. A guardrail at loop boundaries. A claim below a confidence threshold that tries to cross
   into a higher-stakes loop trips a checkpoint that re-surfaces the doubt. This is the
   fleet-level PACE ladder: force the challenge at the boundary instead of letting the
   default resume.

## Information architecture: three levels

### Level 1 — Fleet overview (the control room)

The default position. Its single decision is where do I look. It shows every run as a
rolled-up trust signal derived from the claim, not the agent, grouped into what needs the
supervisor and what is safe, alongside fleet health: counts, pass rate, cost, and any
systemic anomaly. Primary actions are clearing the safe majority in one action, opening a
risky item, and sorting or filtering by trust rather than by agent. The supervisor resolves
the safe majority here without leaving, and descends only for risk.

### Level 2 — Run trust view (the decision)

Reached by drilling into one run. Its decision is approve, reject, or verify. It shows the
claim, the model's confidence verbatim, the upstream doubt preserved intact, the evidence
beside the verdict, and provenance as a secondary detail. Actions are approve, request
changes, one-click verify (rerun, pull the raw trace, or ask an independent model), and turn
a caught failure into a guardrail or eval. Leaving records the rationale and returns the
supervisor to the queue with the counter updated. This is Loop Visibility scaled up from a
demo to a real review decision.

### Level 3 — Hop trace (the loop)

Reached by drilling into a run to see where its doubt originated. Its decision is where did
this go wrong and is the reasoning sound. This is the existing Loop Visibility viewer: the
per-hop gather, act, verify sequence with evidence beside each verdict, the model's
confidence, and the visible reversal. Actions are inspecting raw evidence, marking the
failing hop, and creating an eval case from it. It returns up to the run view.

## The attention principle

The supervisor's home is Level 1. They descend only for risk, and safe work never requires
descending. Navigation is a shallow drill-down and return, plus a lateral move to the next
risky item, so the review has a felt end. That is what keeps review from becoming the new
bottleneck.

## What to build next

The three levels, built in the shared visual language of the polished viewer, so Level 3
already exists and Levels 2 and 1 extend it upward. Suggested order: Level 1 fleet overview
first, because it proves the attention-routing and claim-centric-trust thesis that is the
differentiated part.
