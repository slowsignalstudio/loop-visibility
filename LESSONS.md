# Lessons — Loop Visibility

A running log of what broke, what fixed it, and the transferable lesson. Newest day at
the top. This is raw material for the write-up and for talking through how the build
actually went, not a polished narrative.

## Day 3 — 2026-07-07

### Check which directory your terminal is in before running npm

The first `npm install framer-motion` and a `npm audit fix --force` ran in a different
folder (`Thinking-gym`) instead of `loop-visibility`. The tell was the shell prompt: it
read `Thinking-gym`, not the project name. Nothing in the flagship changed, which is why
the install "worked" but the dependency never showed up in the project.

Lesson: the folder name sits right before the `%` in the prompt. Glance at it before any
install or destructive command. A one-second habit that prevents editing the wrong repo.

How to tell it: "I almost debugged a missing dependency that was never missing, it was
installed into the wrong project because I didn't check my working directory."

### npm audit warnings are a backlog, not a stop sign

`npm audit` reported several high-severity advisories and offered `npm audit fix --force`.
That force flag would have installed a different Next.js version as a breaking change,
mid-build. Most of the advisories were self-hosted denial-of-service issues that Vercel's
platform handles anyway.

Lesson: audit noise is a Week 2 cleanup item, not a reason to change your framework
version in the middle of a build day. `--force` during a sprint is rarely worth the
breakage risk.

### Silent error handling turns a five-minute bug into an hour

The Run button did nothing and showed no error, because the code fired the request but
never checked whether it failed, and the read code ignored errors with `if (data) ...`.
Every layer swallowed its own failure, so the screen just sat there. The moment we
surfaced errors and added a live debug line reporting each read, the problem located
itself in one step.

Lesson: make failures loud before you start guessing. Surface API errors, read errors,
and empty results in the UI. Flying blind is the expensive part, not the bug.

How to tell it: "The bug was invisible because the code hid its own failures. My first
move wasn't a fix, it was making the system tell me what it was doing."

### Debug from the outside in, isolate each dependency

The symptom pointed at the run itself, but the run was fine (`200 in 26.7s`). I tested
each external piece directly against the real keys: the Anthropic call, the Supabase
write, the anon read. All passed. That ruled out three-quarters of the surface area and
pointed at the browser's render path, where the real bug was.

Lesson: when something fails, test each dependency in isolation before assuming where the
fault is. The symptom's location and the bug's location are often different.

### A React state updater must be pure (the real Day 3 bug)

Rows were written, readable, and arriving in the browser (`poll read 3 rows`), yet the
list showed zero. The `addRows` function deduped by mutating an external `seen` Set
*inside* the `setRows` updater. React Strict Mode runs updaters twice in dev to catch
impurity: the first pass added the ids to `seen` and returned them, the second pass saw
them as already-seen and returned an empty list, and React kept the second result. Every
row got deduped into nothing. The fix was to dedupe against the previous rows themselves,
so the updater is pure and gives the same answer both times.

Lesson: never do side effects (mutating a ref, a Set, anything outside) inside a state
updater. If Strict Mode's double-run changes your result, the function isn't pure. This
is the single most useful React idea I learned today.

How to tell it: "The data was all there. The bug was a purity violation in a state
updater that only shows up under React's Strict Mode double-invocation, exactly the class
of bug that passes every non-React test."

### Supabase: the service key bypasses row-level security, the anon key doesn't

An early diagnostic read with the service-role key succeeded, which proved nothing about
the browser, because the browser reads with the anon key under RLS. I had to re-test with
the anon key specifically to trust the read path.

Lesson: test the exact credentials and path your user's code uses, not a more privileged
shortcut. Service-key success can give false confidence.

### Small hygiene: one browser client, not many

The console warned about "Multiple GoTrueClient instances" because `createBrowserClient()`
built a fresh client on every call, all sharing one storage key. Memoizing it into a
single instance per tab removed the warning and the concurrency footgun.

Lesson: client SDKs that hold connections or storage usually want to be singletons.

### Silence is a design problem, not just a slow response

The agent takes ~23 seconds (four sequential model calls) and the screen showed nothing
the whole time. That dead wait is exactly the "silence audit" the build spec calls out:
the fix isn't to make it faster, it's to stream each hop as it lands and show a thinking
state, so the wait reads as progress. Design work, tracked as Day 3.3.

Resolved: added Framer Motion entrance animations on each row and a live "Agent is
[phase]…" indicator that sits below the rows while the run is in flight, naming the hop
it's working on next. The same 23 seconds now reads as progress. Confirmed the fix by
watching a full run: rows ease in one at a time, the thinking row tracks the arc and
disappears at the end.

Two design refinements deliberately deferred (functional, not yet polished): the
evidence-beside-verdict cards in 3.4 want a clearer visual pass, and the phase indicators
could use a stronger "you are here" treatment. Noted here so they don't get lost.
