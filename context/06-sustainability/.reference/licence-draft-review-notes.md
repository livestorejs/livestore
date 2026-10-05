# Review notes for counsel

**This is a draft prepared for legal review. It is not legal advice, and it was not
prepared by a lawyer.** Every clause below is offered as a starting point for your
review, not as a settled position.

Purpose of this document: to save you the work of reverse-engineering intent. It records
what each clause is for, where the draft departs from its source and why, what is
unverified, and what I could not resolve. §12 is the numbered list of open questions.
§13 states what I am least confident in.

All business decisions are settled. `LICENSE.md` has **one** unresolved placeholder
(`{{LICENCE_URL}}`) and **one** remaining choice (`No Liability`, A or B) — and that
choice is yours, not the project's, because it is a question about legal effect rather
than commercial intent. See §10.

**Read §2 first.** It corrects a factual premise I was given, and it constrains the
licence text.

---

## 1. What the licence has to achieve

From the settled requirements (`../licence-requirements.md`), which I treated as fixed:

- Free use requires **all three** of: fewer than 10 individuals; less than USD 1,000,000
  revenue in the prior tax year; less than USD 1,000,000 in aggregate external
  investment. Conjunctive, deliberately. Fixed figures, **not** inflation-indexed.
  Affiliates aggregate across all three.
- Unconditional grants regardless of that gate for: individuals, noncommercial and public
  organisations, and a ~30-day evaluation.
- Modification and redistribution as part of the licensee's own application permitted.
- **Downstream recipients of a licensee's application must not need their own licence.**
- Every release converts to Apache-2.0 two years after its own publication.
- No non-compete. No source-disclosure obligation. No technical enforcement. **No audit
  rights.** No governing-law clause in the public licence.
- Future releases only; prior releases stay Apache-2.0 irrevocably.
- Licence name: LiveStore Community License 1.0. Licensor: Johannes Schickling.
- `@livestore/wa-sqlite` excluded, stays MIT.

The context that makes several of these load-bearing: **LiveStore is a client-side
library that ships inside other people's applications.** Most source-available licences
were drafted for server software, and several of their standard clauses misbehave in this
setting. §3 and §4 are the two places that bites.

---

## 2. Provenance and the licence of the source texts — correcting the brief

The draft is adapted from three licences in the same plain-English family: a
small-business-gated licence, a noncommercial licence, and a free-trial licence, each at
version 1.0.0. I took canonical text from the publisher's release tags in their source
repository rather than from their website — see the note on availability below.

**I was told these texts are licensed CC-BY-4.0 and that the derived licence must carry
attribution. That is incorrect, and the correct position points the opposite way.**

The publisher's own repository states the terms, identically at all three refs I checked
(`master`, the `1.0.0` branch, and the `Polyform-Small-Business-1.0.0` release tag):

> Each contributor licenses you to do everything with PolyForm licenses that would
> otherwise infringe that contributor's copyright in it.
>
> If you make changes to a PolyForm license, you must remove all mention of "PolyForm"
> and polyformproject.org, as well.

So: a bare permissive copyright grant with **no attribution requirement**, and a
**de-branding requirement** attached to modified texts. The publisher also holds a US
trademark application for the mark (serial 88400646), which is consistent with reading
the de-branding condition as a trademark-protective term rather than a copyright one.

I traced the CC-BY-4.0 claim to its likely source: ScanCode LicenseDB's pages for these
licences carry a footer stating that *the database* is licensed CC-BY-4.0. That footer
describes ScanCode's own catalogue, not the licence texts.

**Consequences, which I have acted on:**

1. `LICENSE.md` contains **zero** occurrences of the family name or the publisher's
   domain. I verified this with a grep; it returns nothing. Please re-verify after you
   edit.
2. **I did not copy the precedent's provenance header.** The closest precedent for this
   exact adaptation — Statiq's "Statiq Public License 1.0.0", which combines the same
   three source licences and modifies the same two thresholds — opens with a paragraph
   naming the family three times and linking the publisher's domain three times. On the
   reading above, that header is the one thing Statiq got wrong. I took their **clause
   composition**, which is sound and is direct precedent for what we are doing, and
   discarded their header.
3. The licence needs a **project-hosted canonical URL**. The `Notices` clause obliges
   recipients to get "these terms or the URL for them above"; with the publisher's URL
   removed there must be one of our own. I added a placeholder the brief did not list:
   **`{{LICENCE_URL}}`**. It must resolve before the first covered release.

**My interpretation, flagged as mine:** I read the de-branding condition as binding the
*modified licence text*, not as barring a separate memo that discusses derivation. That
is why this document names the family freely and `LICENSE.md` does not. If you read the
condition more broadly, this document would need sanitising too. **See Q1.**

**Availability note, relevant to (3):** the publisher's website is currently returning
404 for every subpage — `/licenses`, `/about`, and each individual licence URL — while
the domain root serves. It was live in the Internet Archive's 2026-07-17 snapshot and is
broken as of 2026-07-27, most likely from a site push on 2026-07-12. This does not affect
the draft, since I took text from release tags, but it is a concrete reason not to
depend on a third party's domain for canonical licence text. It also means any licensee
following a URL in the unmodified upstream licences right now reaches a 404.

---

## 2a. Placeholder inventory — all but one now resolved

Every placeholder from the brief has been resolved into the text: `{{LICENCE_NAME}}` →
LiveStore Community License 1.0; `{{LICENSOR}}` → Johannes Schickling (see §11 for how it
is carried); `{{GOVERNING_LAW}}` → section deleted (§9); `{{SUNSET}}` → two-year
per-version Apache-2.0 conversion (§7); `{{AUDIT_RIGHTS}}` → section deleted (§8);
`{{REVENUE_DEFINITION}}` and `{{INDIVIDUALS_DEFINITION}}` → resolved in §6, plus the new
investment limb in §5.

I had added three placeholders of my own. Two are now gone, one remains:

| Placeholder | Status |
| --- | --- |
| **`{{LICENCE_URL}}`** | **Still open — the only one.** The `Notices` clause obliges recipients to get the terms *or the URL for them*. Removing the source publisher's URL under the de-branding condition (§2) leaves nothing there. A project-hosted canonical URL must exist and resolve before the first covered release. |
| `{{LICENSOR_URL}}` | Gone. The `Required Notice:` example now reads simply `Copyright Johannes Schickling`, with no URL, so nothing needs inventing. |
| `{{VENUE}}` | Gone with the `Governing Law` section (§9). |

`{{SUNSET_PERIOD}}` and `{{SUNSET_LICENCE}}` are also gone, resolved into the text as two
years and Apache-2.0 respectively (§7).

`NOTICE-AND-PACKAGING.md` carries one further placeholder of its own,
`{{FIRST_COVERED_VERSION}}` — the version number at which the new licence takes effect.
That is a project decision, not a legal one, but it must be fixed before launch because
three separate documents refer to it.

I invented no substantive figures, names, periods or jurisdictions anywhere. The only
concrete numbers in the operative text are those the project fixed (10 individuals, USD
1,000,000 revenue, USD 1,000,000 investment, two-year conversion), the 32-day cure period
inherited unchanged from the source, and the 30-day evaluation period discussed at §3.

---

## 3. The individual-grant defect, and how the draft fixes it

The small-business licence's only permitted purpose is *"use of the software for the
benefit of your company"*. It therefore grants **nothing** to an individual acting for
themselves — no hobbyist, no student, no one building a portfolio piece. The drafter has
confirmed this and his suggested remedy is to dual-licence with the noncommercial
licence. For a library that most people first meet through a weekend project, shipping
that defect would be fatal.

The draft fixes it by composing sections rather than dual-licensing, giving four
independent permitted purposes. **A user needs to satisfy only one.** That structure is
the essential design decision and is worth confirming reads that way to you.

### `Personal Uses` — deviation from source, deliberate

The source noncommercial licence reads:

> Personal use for research, experiment, and testing for the benefit of public
> knowledge, personal study, private entertainment, hobby projects, amateur pursuits, or
> religious observance, **without any anticipated commercial application**, is use for a
> permitted purpose.

I made two changes:

- **Removed "without any anticipated commercial application".** The requirements
  explicitly include *portfolio work*. A portfolio piece is built precisely in
  anticipation of commercial benefit — getting hired. The qualifier would exclude the
  single case the requirement names. It would also make the grant turn on a developer's
  private future intentions, which is unknowable and therefore unadministrable.
- **Added portfolio work by name**, and added an explicit negative boundary: work for an
  organisation, including an employer or a client, is not personal use, and falls to the
  other sections.

**Trade-off you should weigh:** without the "no anticipated commercial application"
qualifier, `Personal Uses` is broader than its source. A sole developer could argue that
solo commercial work is "an individual's own purposes". I have relied on the negative
boundary sentence plus the `Your company` definition to close this — see §5 — but the
seam is real and it is the widest one in the draft. **See Q2.**

### `Noncommercial Organizations` — near-verbatim

Taken from the source noncommercial licence essentially unchanged, with "whatever the
size of the organization" added to satisfy the requirement's "regardless of size or
funding source". The source already covered funding source; size was implicit and is now
explicit.

### `Evaluation` — deviation from source, deliberate

Three changes from the source free-trial licence:

- **30 days rather than 32.** The requirement says ~30 days. The source's 32 is a
  drafting convenience (it guarantees a full calendar month has elapsed regardless of
  month length). 30 is what a reader expects and what the requirement says. If you prefer
  32 for that reason, say so — I have no attachment to 30.
- **Added an explicit carve-out of external distribution.** The source free-trial licence
  forbids distribution outright. Ours cannot, because the same document grants
  distribution elsewhere. Without the carve-out, "evaluation" would let an
  above-threshold organisation ship a production application free for 30 days, and
  arguably keep re-starting the clock for each "project". The carve-out limits evaluation
  to internal use.
- **Retained multiple concurrent evaluations** for different needs or projects, matching
  the source and the publisher's later working draft.

**A problem with the narrow form, which I have left as drafted but want to flag.** The
carve-out means an ineligible organisation may trial the software only internally. For a
*server* library that is a complete evaluation. For a client-side library whose entire
purpose is shipping inside an application that reaches end users, it is not: the
organisation cannot build anything it can put in front of a real user, which is exactly
what evaluating this library means. So `Evaluation`, as drafted, offers less than it
appears to, and the signpost's "may evaluate it for 30 days" slightly oversells it.

I left the narrow form because widening it re-opens the hole it was added to close — an
ineligible organisation shipping production software free under a rolling "evaluation".
But there are middle positions: permit distribution to a small number of named pilot
users, or to non-production deployments, or permit external distribution during the 30
days on condition it stops at the end. Each needs care to avoid becoming a loophole.
**See Q23.**

---

## 4. The two library-specific problems, and the clauses that fix them

These are the parts of the draft with **no counterpart in any source text**. They are
where I would most want your attention.

### 4a. `Your Application` + `Application Users` — the downstream grant

**The problem.** Under the unmodified source structure, distribution is permitted, but
every recipient must accept the terms themselves and must have their own permitted
purpose, and `No Other Rights` bars the licensee from sublicensing. So: a qualifying
five-person startup ships a web application containing the library. A 5,000-person
enterprise uses that application. The enterprise's browsers download and copy the
library; the enterprise has no permitted purpose and cannot get one from the startup.
Result: the startup's customers are infringing, and the startup cannot fix it. For a
library that ships inside other people's products, that is a product-breaking defect,
and the requirements identify it as such.

**The fix.** Two new sections:

- **`Your Application`** defines the unit of redistribution: a product of the licensee's
  own that includes the software as a component and adds substantial functionality of its
  own. Bare redistribution of the software, and products whose main value is the software
  itself, are excluded.
- **`Application Users`** grants recipients of that application copyright and patent
  licences **directly from the licensor** to run, copy, install, host, deploy, and pass
  along the software as part of the application, for any purpose, regardless of their
  size or purpose, with no other licence needed.

**Five drafting choices inside this, each deliberate:**

1. **Direct grant, not sublicence.** This is what makes it consistent with
   `No Other Rights`. I also added a cross-reference in `No Other Rights` pointing at
   `Application Users`, so the two do not read as contradicting each other.
2. **Carved out of `Acceptance`.** `Acceptance` conditions every licence on the
   recipient agreeing to the terms, and `you` is defined as the person agreeing.
   Application Users recipients by construction never see the terms and never agree, so
   without a carve-out `Acceptance` would deny them the very licence `Application Users`
   grants — the document would defeat itself before you reached the question of whether
   the construction works at all. `Acceptance` now states that it does not apply to
   those licences and that the licensor grants them without requiring agreement. This is
   the same cross-reference pattern used in `No Other Rights`. **This was a real defect
   in an earlier version of the draft; flagged so you know it was found rather than
   never present.**
3. **Verb list covers hosting and deployment, not just running.** An early draft said
   only "run and make copies", which arguably fails the case where a recipient
   *self-hosts* the licensee's application on its own infrastructure — a normal
   enterprise-software pattern. "Install, host, and deploy" closes that.
4. **Conditioned on the distribution having been permitted when made**, so an
   unqualified distributor cannot manufacture free rights for others.
5. **Survives the licensee's licences ending**, stated both in `Application Users` and
   again in `Violations`. Without this, a licensee's later breach retroactively
   infringes on every copy already in end users' hands — commercially intolerable and
   the main reason `COMMERCIAL-LICENSE-NOTES.md` §5 recommends a perpetual model.

**A consequence you should decide on, not a defect.** `Patent Defense` terminates the
patent licence on a written infringement claim by "you" or "your company". Application
Users recipients are deliberately **not** "you" — that is correct and consistent
throughout the clause, and it is what makes the direct grant work. But it follows that an
above-threshold enterprise using a licensee's application holds a patent licence from the
licensor with **no defensive-termination hook attached to it**. If that is not wanted,
`Application Users` needs its own defensive-termination sentence. I have not added one,
because doing so would partly undo the "no other licence needed, nothing to agree to"
property that the clause exists to create. **See Q3.**

**Known weakness.** "Substantial functionality of its own beyond the software" and
"a product whose main value is the software itself" are the anti-circumvention test, and
they are vague. A determined enterprise could route around the gate through a thin
wrapper published by a hobbyist. I do not think more words fix this — every formulation I
tried either failed to exclude the wrapper or accidentally excluded a legitimate thin
integration library. It is a judgement call about how much to tighten and I have left it
deliberately loose rather than risk the false negative. **See Q4.**

### 4b. `Notices` — deviation from source, deliberate

**The problem.** The source clause obliges the licensee to ensure that anyone who gets a
copy of **any part** of the software also gets the terms or the URL. End users of a
minified web bundle *do* receive a copy of parts of the software, and never see a licence
file. Read literally, **every licensee shipping a web application is in breach**.

**The fix.** The obligation is split. Distributing the software on its own or in source
form keeps the full obligation. Distributing it only as part of an application, in
compiled/bundled/minified/processed form, is satisfied by including the same notices in
the application's documentation, credits, or third-party-notices — the conventional
practice the whole ecosystem already follows.

This is a real narrowing of the licensor's notice rights, chosen because the alternative
is a clause nobody can comply with. `NOTICE-AND-PACKAGING.md` §7 recommends publishing a
copy-pasteable attribution block to make compliance trivial. **See Q5.**

**A second, related narrowing, which I noticed and left in place.** `Application Users`
lets recipients "pass your application along to others". Those recipients are not "you",
and are carved out of `Acceptance`, so **no notice obligation attaches to them at all**.
The notice chain therefore terminates at the first downstream hop: the licensee must
carry notices into their application, but a reseller or redistributor of that application
need not carry them further.

I believe this is unavoidable rather than a defect. Obligations cannot sensibly attach to
people who never agreed to anything, and making the downstream grant conditional on
compliance would reintroduce exactly the "downstream recipients need their own licence"
problem the clause exists to solve. But it is a deliberate choice and it does reduce
attribution reach, so it should be a decision rather than a discovery. If you want notices
to propagate further, the mechanism would have to be an obligation on the *licensee* to
require it of their own redistributors — which is enforceable against someone who did
agree, and is how this is usually solved.

---

## 5. The eligibility gate — three limbs

Drafted from the small-business licence's `Small Business` clause, with the third limb
having no precedent anywhere. Changes from the source:

- **Section renamed** from `Small Business` to `Eligible Organizations`. The source name
  is no longer accurate: a three-person company that raised USD 1.5M is unambiguously a
  small business and is unambiguously gated. Leaving the heading as "Small Business"
  while the test excludes obvious small businesses would be actively misleading.
- **Thresholds:** 100 → **10** individuals; USD 1,000,000 revenue retained; **USD
  1,000,000 external investment added as a third limb.**
- **CPI indexing removed entirely.** The source says `1,000,000 USD (2019)` followed by a
  sentence directing the reader to adjust for inflation via the US BLS CPI-U index. The
  requirements reject indexing: it obliges every prospective licensee to perform an
  index lookup before knowing whether they may use the software. I removed **both** the
  adjustment sentence **and** the `(2019)` parenthetical — the parenthetical is
  meaningless without the mechanism and would read as a drafting error. In its place the
  draft states affirmatively that the figures are fixed and not adjusted for inflation,
  and that a later version using different figures does not change these ones.

  *This is a live trap.* The Statiq precedent modified the numbers but kept both the
  `(2019)` marker and the full CPI sentence. Anyone adapting from Statiq by swapping
  figures will silently reimport exactly what the requirements reject.
- **Conjunctive test made explicit.** "Your company must meet all three. If it fails any
  one of them, use for its benefit is not a permitted purpose under this section." The
  three limbs are also set out as a labelled list rather than a run-on sentence, because
  at three conditions the prose form becomes genuinely hard to parse.
- **Different measurement periods, stated explicitly.** People and revenue are measured
  over the prior tax year; investment is measured over the company's whole history. Two
  different frames in one test is a real comprehension hazard, so the draft states it in
  its own paragraph rather than leaving a reader to infer it from the definitions.
- **New-company case added, and scoped.** The source has no rule for a company with no
  prior tax year, which is undefined for a large share of the target audience. The draft
  permits use during the first tax year until either the people or revenue figure is
  passed — and **expressly does not extend to the investment limb**, so a newly
  incorporated company that has just raised USD 5M is gated from day one. Without that
  scoping the new-company rule would swallow the investment limb entirely for exactly the
  companies it targets. **Confirm — see Q6.**
- **Affiliate roll-up** comes free from the source's `Your company` / `Control`
  definitions, which the draft keeps verbatim. The draft adds one closing sentence in
  Definitions making explicit that it applies to all three figures, and the gate section
  cross-references it. For investment this means a group's historical raises aggregate:
  a subsidiary of a well-funded parent is gated by the parent's fundraising.

### The investment limb — my least-precedented clause

**This is the single clause in the document with no precedent I could find anywhere.**
Not in the PolyForm family, not in FSL, BUSL, SSPL or Elastic, not in Statiq. Every
existing size-gated licence gates on headcount and revenue. I could find none that gates
on capital raised. Treat the drafting as a first attempt rather than an adaptation of
something tested, and please give it disproportionate attention.

What the definition does:

| Counts | Does not count |
| --- | --- |
| Equity investment | Bank borrowing on ordinary commercial terms |
| Convertible notes, SAFEs and similar, **at the amount received when received, not on conversion** | Trade credit |
| Venture debt | Money the company earned |
| Revenue-based financing | Government grants, subsidies, research funding, prize money |
| | Charitable donations |
| | Money put in by the company's own founders or employees from their own funds |

Reasoning for each of the contested calls, so you can overrule them individually:

- **Convertible instruments counted on receipt, not conversion.** A SAFE is not equity
  until it converts, so a definition keyed to shares alone would let a company hold USD
  5M on SAFEs and remain eligible indefinitely. Counting at receipt closes that, and it
  is also the figure the company actually knows.
- **Venture debt and revenue-based financing count; ordinary bank borrowing does not.**
  The line drawn is whether the terms are tied to the company's equity, revenue or
  growth. This is the softest boundary in the definition and the place a well-advised
  licensee would push. A structured facility deliberately dressed as commercial lending
  is a foreseeable workaround and the current wording may not catch it.
- **Grants and subsidies do not count.** They are not investment; nobody took a stake.
  But this creates a visible gap against the limb's own rationale: a company sitting on a
  EUR 2M research grant plainly has ability to pay and remains eligible. If the intent is
  "ability to pay" rather than "has investors", grants should count and the definition
  needs changing. **See Q7.**
- **Founder capital does not count.** "External" investment naturally excludes the
  founders' own money. But a founder who puts USD 2M of personal wealth in is
  indistinguishable, in ability-to-pay terms, from one who raised it. Same tension as
  grants, same question.

**The consequence you should be most sure about is permanence.** Because investment is
cumulative to date and never resets:

> A company that raised USD 1.2M in 2019, spent it, failed, and is now three people with
> no revenue and no investors is **permanently ineligible**, with no route back, forever.

That is the harshest edge in the document by a wide margin. It is a direct consequence of
"cumulative-to-date", which the project chose deliberately and which I have drafted
faithfully and unambiguously rather than softening. But it is not what the word
"Community" in the licence name leads a reader to expect, and it will produce at least
one bad story. **See Q8**, which offers three ways to soften it if wanted.

I have deliberately **not** editorialised about any of this in the licence text itself,
per instruction. The text states the rule plainly and leaves it there.

### An open item from the requirements that I believe is now answered

Requirements open item 5 asks whether the individual grant should extend to sole traders
and single-person companies. **I think the definitions already settle it.** The
`Your company` definition expressly includes "sole proprietorship", and `Personal Uses`
expressly excludes work for an organization including a client. So a sole trader doing
client work falls to `Eligible Organizations` — where, being one person with no outside
investment and under USD 1,000,000, they pass. Flagged here so you can disagree rather
than rediscover it.

---

## 6. Revenue and headcount definitions — both resolved

**Headcount: the source wording, unchanged.** "Fewer than 10 total individuals working as
employees and independent contractors." No definition added — bodies, not
full-time-equivalents, on any working basis. I had offered an FTE variant and a
count-everyone variant; the project chose to add neither, which is the right call at a
threshold of 10, where arithmetic costs more than it clarifies. The consequence is that
"total individuals" carries its ordinary meaning, and the offshore-agency edge I
previously flagged is left unaddressed on purpose rather than by oversight. A company
using a 30-person agency team through a single contract is, on the plain words, not
employing 30 individuals. **See Q9** if you think that needs closing.

**Revenue: defined, and the definition now does double duty.** Gross, before costs,
across the company and its affiliates, counted once. It expressly excludes external
investment, grants, subsidies and donations.

The investment carve-out is no longer merely a clarification — it is now **structurally
required**. With investment gated as its own limb, counting the same money as revenue too
would double-count it and make the revenue limb unpredictable. The two definitions have
to be read together and are drafted to be mutually exclusive. If you change one, check
the other.

---

## 7. The two-year conversion — mechanism chosen and why

Settled: each version converts to Apache-2.0 on the second anniversary of **its own**
publication. I was asked to compare two mechanisms and pick.

### The candidates

**PolyForm Countdown 1.0.0** is a *separate document*, shipped alongside each release,
with an explicit ISO-8601 start date filled in per release and the full target licence
text copied into it. Its virtues are precision and, especially, its framing:

> Legally, this is a present grant of a license on the date of release, not a contract
> promise to grant the license later.
>
> No contributor can revoke the new license before it starts.

**FSL's Grant of Future License** is an *inline clause* in the licence itself:

> We hereby irrevocably grant you an additional license to use the Software under the
> Apache License, Version 2.0 that is effective on the second anniversary of the date we
> make the Software available.

### What I chose, and why

**FSL's structure, with Countdown's framing sentences imported into it.**

The deciding factor is operational, and it is decisive at this project's scale.
Countdown's defining feature is that it is a per-release artefact. LiveStore publishes
24 packages in lockstep; adopting Countdown means generating and shipping a second
licence document, carrying a correct computed date, with every release, forever. A
missing file or a wrong date in one package silently breaks or muddies that package's
conversion, and nothing in the build would catch it. FSL's clause cannot be omitted,
because it is part of the licence text that already has to ship.

Two further points against Countdown as a document:

- It requires the target licence text to be copied in wholesale, which would roughly
  double the licence's length for a project already carrying more sections than the
  source.
- Its canonical URL is currently dead (§2), and its repository describes it as working
  drafts. FSL's wording, by contrast, is in production at Sentry, Codecov, Convex,
  GitButler, PowerSync, NativeLink and CodeCrafters.

**But Countdown's legal framing is better than FSL's, and I took it.** FSL relies on
"hereby irrevocably grant" to do the work implicitly. Countdown says the quiet part out
loud: this is a present grant, not a promise. That distinction matters, because a bare
promise to grant a licence in future, unsupported by consideration, is the obvious line
of attack on this kind of clause. The draft therefore adds two sentences FSL does not
have:

> This is a present grant of that additional license, made now. It is not a promise to
> grant it later. The licensor cannot revoke it before it takes effect.

### Deviations from both sources

- **No cascade.** My earlier draft had each version's conversion also release all earlier
  versions, so a licensee tracked only one date. The project specified per-version
  conversion from each version's own publication, so I removed it. Consequence: a
  licensee wanting to rely on the Apache-2.0 grant must check the date for each version
  they use. `NOTICE-AND-PACKAGING.md` §5 addresses this with a published conversion table.
- **`Apache Date:` line retained** from my earlier draft, renamed from `Change Date:` to
  avoid confusion with BUSL's differently-behaving term of art. It lets the project pin
  an exact date per release rather than obliging each licensee to compute one. Strongly
  recommend using it; see Q10.
- **Added to `Violations`,** so that a licensee whose licences end does not lose
  Apache-2.0 rights that had already vested. Without this, breach would retroactively
  strip rights the licence says are irrevocable — an internal contradiction.

### Reuse position on FSL's wording

FSL imposes the same de-branding condition as the PolyForm family — its FAQ says that a
variant with a different conversion licence must "call it something other than FSL". The
draft complies with both by construction: it is the LiveStore Community License and names
neither family.

But unlike PolyForm, **FSL publishes no express grant covering reuse of its text.**
PolyForm states one plainly in its repository; I could find no equivalent for FSL, only
the renaming condition. So the copyright position on the ~40 borrowed words is unstated
rather than permissive. In practice short functional legal wording of this kind is
routinely adapted across licences, and the project has complied with the one condition
FSL does state — but I am flagging the asymmetry rather than assuming it away. **See Q17.**

---

## 8. Audit rights — none, as instructed

Settled: no audit clause, no inspection right, no obligation to confirm eligibility on
request. Pure honour system. The `Confirming You Qualify` variant I had drafted is
deleted, not commented out.

This is the right call for a public licence aimed at developers, and it matches the
requirements' position that enforcement is contractual rather than technical. Two things
follow that counsel should be aware of rather than surprised by:

- **The licensor has no contractual route to information.** Combined with no technical
  enforcement, the only mechanism against a non-compliant organisation is the `Violations`
  clause, which requires the licensor to already know about the violation. In practice
  the gate is enforced by licensees choosing to comply.
- **This raises the stakes on the self-assessment question.** With three limbs — one of
  which requires a company to total its fundraising across its entire history and its
  affiliates — good-faith misassessment is likely, not hypothetical. **See Q12.**

A *paid, signed* agreement can reasonably carry a verification term that a free public
licence should not; see `COMMERCIAL-LICENSE-NOTES.md` §7.

---

## 9. Governing law — omitted, as instructed

Settled: the public licence is silent on governing law and forum. The optional
`Governing Law` section and the `{{VENUE}}` placeholder are deleted.

This matches Apache-2.0, MIT, the PolyForm family and FSL — none carries a governing-law
clause. It was also my recommendation before the decision was made, for the reason given
in the earlier draft: a public licence offered to the world is not a negotiated contract,
and naming a forum invites the argument that it is one, while being unlikely to survive
against a consumer or small business in an unfavourable jurisdiction.

Governing law and forum for the **commercial** agreement are settled as German law,
courts of Berlin. That is covered in `COMMERCIAL-LICENSE-NOTES.md` §11, together with the
German-law points that follow from it — in particular that the AGB regime (§§305–310 BGB)
may apply to self-serve standard terms and constrains liability exclusion far more than
US drafting assumes.

---

## 10. Warranty and liability — where plain English may be legally weaker

**This is the clause where I am least comfortable, and I have not chosen for you.**

The draft offers two labelled variants of `No Liability`:

- **Variant A** — the source licences' single bold sentence, verbatim: *"As far as the
  law allows, the software comes as is, without any warranty or condition, and the
  licensor will not be liable to you for any damages arising out of these terms or the
  use or nature of the software, under any kind of legal claim."*
- **Variant B** — the same plain-English register, but naming merchantability, fitness
  for a particular purpose, title, non-infringement, course of dealing and usage of
  trade, and naming the excluded damage categories including consequential and lost
  profits.

**The concern.** Under UCC §2-316(2) an exclusion of the implied warranty of
merchantability must *mention merchantability*, and an exclusion of fitness must be in
writing and conspicuous. Variant A mentions neither by name. It is possible that "without
any warranty or condition" plus "as far as the law allows" is read as sufficient, and the
drafters of the source licences are experienced practitioners who presumably considered
this — that is real evidence for A. But Variant A is untested in litigation as far as I
can determine, and the downside of being wrong is asymmetric: the licensor bears it
entirely. Similar concerns apply to excluding consequential damages without naming them,
and to jurisdictions outside the US with their own conspicuousness or
incorporation requirements.

Both variants are already bolded and italicised, which is the conventional way of meeting
a conspicuousness requirement in a Markdown document, and I have preserved that from the
source in both.

**I have deliberately not picked, and this is now the only unmade choice in the
document.** The project told me every placeholder was resolved and nothing further was
open. I read that as addressing the `{{PLACEHOLDER}}` items, which were business
decisions. This one was never a placeholder — it was flagged for counsel from the start,
and it is a question about legal effect rather than commercial intent. I have therefore
left it as a live A/B choice rather than picking silently. If the project intended to
close it too, say so and I will resolve it.

**One further point, new since the governing-law decision.** The commercial agreement is
now to be governed by German law (`COMMERCIAL-LICENSE-NOTES.md` §11), and German law does
not permit excluding liability for intent or gross negligence, or for injury to life,
body or health, however drafted. The `No Liability` analysis above is US-centric because
the source wording is. If German or EU law is likely to govern disputes under the
**public** licence too — which is plausible given the licensor is resident there, even
with no forum clause — then neither variant is calibrated for it and a third, German-law
variant may be needed. **See Q15.** **See Q11** for the original US-law question.

---

## 11. Licence name and licensor — two drafting consequences

### The name

Settled: **LiveStore Community License 1.0**, SPDX `LicenseRef-LiveStore-Community-1.0`.

Two things I did in response, and one risk I could not draft away.

**Prominence.** The name leads with "Community" while the gate is genuinely tight — a
three-person company that has ever raised USD 1.5M is excluded. A reader who meets the
name first and the conditions late will feel the name oversold it. The draft therefore
opens with a **`Who May Use This Software For Free`** section, before `Acceptance`, that
states all three limbs in plain words in under sixty. It names the investment limb
explicitly rather than saying "small teams use it free", because a signpost that omits
the least expected condition is worse than no signpost.

**The summary-versus-operative risk this creates.** A summary in an operative document
invites the argument that the summary governs where the two diverge, and short plain
wording will inevitably be less precise than the sections it summarises. The draft
closes this with an express deferral — "The sections below govern. This summary does not."
I believe that is sufficient, but it is a construction risk that did not exist before and
you should confirm the deferral wording is strong enough. The alternative is to move the
summary out of `LICENSE.md` into the docs site, which removes the risk entirely at the
cost of the prominence the project asked for. **See Q13.**

**Naming collision risk I could not resolve.** "Community License" is well-trodden:
Confluent Community License, Elastic, MongoDB and Redis have all used "Community" or
"Source Available" branding for source-available licences. Nothing prevents reusing the
word, but a reader familiar with those may assume LiveStore's terms match one of them,
and they do not. Worth a trademark search before launch. **See Q14.**

### The licensor as a natural person

Settled: **Johannes Schickling**, an individual, intending to assign to an entity later.

**I changed the drafting in response, and it removes the need for an assignment clause.**
An earlier draft defined the licensor as the named person: "The **licensor** is
{{LICENSOR}}". Hard-coding a natural person into the Definitions section is exactly the
wrong shape when assignment is planned — after an assignment the operative text would
still name the individual, and every package would need its licence text re-issued.

The draft now restores the source licences' generic definition — "The **licensor** is the
individual or entity offering these terms" — and carries the name only in the
`Required Notice:` line and the repository-root `LICENSE`. The licensor is then whoever
is offering the terms at the time, which is the assignee after an assignment.

**On whether an express assignment clause is needed: I do not think so, and silence is
better than a clause.** Copyright is assignable, and an assignee takes subject to
licences already granted, so existing licensees are unaffected and the assignee steps
into the licensor's position automatically. `No Other Rights` restricts the *licensee*
from transferring their licences; it says nothing about the licensor and does not need
to. Adding an express assignment right would be the only clause in the document
addressing the licensor's own dealings, which reads oddly and invites the question of
what else is reserved. **See Q16.**

**The commercial side is different and does need a clause.** Signed agreements are
contracts, and moving the licensor's side to a new entity may need customer consent
depending on drafting. `COMMERCIAL-LICENSE-NOTES.md` §12 recommends including an
assignment-to-successor clause in every commercial agreement from the first one, and
flags that a natural person signing commercial agreements carries the obligations
personally with no corporate veil — which, combined with German law's limits on excluding
liability, is a real exposure. Counsel may want to advise forming the entity before
signing anything.

---

## 12. Open questions — numbered

All business decisions are settled; these are legal questions. **Q3, Q7, Q8 and Q11 are
the ones I would most want answered.**

1. **De-branding scope.** I read the source publishers' conditions (PolyForm: "remove all
   mention of PolyForm and polyformproject.org"; FSL: "call it something other than FSL")
   as binding the modified licence text only, so `LICENSE.md` names neither family but
   these notes discuss derivation freely. Is that right? Related: is PolyForm's condition
   a copyright term, a trademark term, or both, and does that change the answer? (§2)
2. **Breadth of `Personal Uses`.** I removed "without any anticipated commercial
   application" to admit portfolio work. Does the negative boundary sentence plus the
   `Your company` definition adequately stop a solo commercial developer relying on
   `Personal Uses` instead of `Eligible Organizations`? (§3)
3. **Patent defence and Application Users.** Application Users recipients get a patent
   licence with no defensive-termination hook, because `Patent Defense` binds only "you"
   and "your company". Acceptable, or should `Application Users` carry its own? (§4a)
4. **Anti-circumvention in `Your Application`.** Is "substantial functionality of its own
   beyond the software" / "a product whose main value is the software itself" a workable
   test, and can it be tightened without excluding legitimate thin integration
   libraries? (§4a)
5. **Narrowed `Notices`.** Is accepting a third-party-notices file as compliance for
   bundled distribution acceptable, and does it weaken any later claim? Note also that the
   notice chain terminates at the first downstream hop, for the reason given at §4b. (§4b)
6. **New-company rule, and its scoping.** A company with no prior tax year is treated as
   meeting the people and revenue figures during its first tax year, but **not** the
   investment figure. Is that the right split? Without it the rule would exempt exactly
   the newly-incorporated well-funded startups the investment limb targets. (§5)
7. **The investment limb — definitional boundaries.** This is my least-precedented
   clause and it needs line-by-line review. Specifically: (a) are convertible instruments
   correctly counted at receipt rather than conversion? (b) is "tied to your company's
   equity, revenue, or growth" a workable line between venture debt and ordinary
   borrowing, and does it catch a facility deliberately structured to look like
   commercial lending? (c) should government grants count, given a grant-funded company
   plainly has ability to pay? (d) should founder capital count, for the same reason?
   (§5)
8. **The permanence of the investment limb.** Because it is cumulative to date and never
   resets, a company that raised USD 1.2M in 2019, spent it, and is now three people with
   no revenue is permanently ineligible with no route back. This is deliberate and I have
   drafted it faithfully. If it is ever to be softened, the three mechanisms are: measure
   over a trailing window (e.g. the last five years); allow the investment limb to be
   disregarded where revenue and headcount are both far under; or add a discretionary
   reinstatement the licensor can grant. Each has costs. Do any warrant adding? (§5)
9. **Headcount left undefined.** The source wording is kept unchanged, so "total
   individuals working as employees and independent contractors" carries its ordinary
   meaning. That leaves the offshore-agency case open: a company using a 30-person agency
   team through one contract is, on the plain words, not employing 30 individuals. Leave
   it, or close it? (§6)
10. **The conversion mechanism.** Is the present-grant framing ("This is a present grant
    of that additional license, made now. It is not a promise to grant it later.")
    sufficient to defeat the argument that a future grant unsupported by consideration is
    unenforceable? And is "the date the licensor first made that version available"
    adequately certain, or should it be tied to npm publication specifically? (§7,
    `NOTICE-AND-PACKAGING.md` Q-P4)
11. **Warranty and liability.** Variant A or B — the only remaining choice in the
    licence, and the clause most likely to be legally weaker in plain English than in
    conventional wording. (§10)
12. **Enforceability of self-assessment, now with no audit rights.** With three limbs —
    one requiring a company to total its fundraising across its whole history and its
    affiliates — good-faith misassessment is likely rather than hypothetical, and the
    licence now has no mechanism to ask. Is the gate enforceable against a licensee who
    self-assesses wrongly in good faith? (§8)
13. **The summary section.** `Who May Use This Software For Free` sits before
    `Acceptance` and expressly defers to the sections below. Is the deferral wording
    strong enough to prevent the summary being read as operative where it is less precise
    than the clauses it summarises? (§11)
14. **Licence name.** "Community License" is used by Confluent, Elastic, MongoDB and
    Redis for source-available licences with materially different terms. Worth a
    trademark search, and is there a confusion risk with those? (§11)
15. **German law and the public licence.** The commercial agreement will be governed by
    German law. The public licence has no governing-law clause, but the licensor is
    resident in Germany, so German or EU law may govern disputes under it regardless.
    Neither `No Liability` variant is calibrated for a legal system that forbids
    excluding liability for gross negligence. Is a third variant needed? (§10)
16. **Licensor assignment.** I concluded that silence suffices for the public licence —
    copyright is assignable and an assignee takes subject to existing licences — and that
    an express assignment clause would read oddly as the only provision addressing the
    licensor's own dealings. Confirm. The commercial side does need a clause; see
    `COMMERCIAL-LICENSE-NOTES.md` §12. (§11)
17. **Reuse of FSL's wording.** FSL publishes no express grant covering reuse of its
    text, unlike PolyForm. The draft complies with the one condition FSL does state
    (renaming), but the copyright position on the borrowed ~40 words is unstated rather
    than permissive. Is that a real exposure? (§7)
18. **Interaction with the surviving Apache-2.0 grant.** My drafting position: state the
    backward boundary plainly in the repo root and release notes and keep it out of the
    operative licence; the forward boundary belongs in the licence because it is a grant
    the licence makes. Confirm. (`NOTICE-AND-PACKAGING.md` §5)
19. **`wa-sqlite` fork copyright.** Does the fork contain enough original authorship for
    a second copyright line, and in whose name? (`NOTICE-AND-PACKAGING.md` §3, Q-P2)
20. **Acceptance mechanics.** `Acceptance` makes agreement both a strict obligation and a
    condition of the licences. For software installed by a package manager with no
    click-through, is that sufficient to bind? Separate from the Application Users
    carve-out at §4a(2), which fixes an internal contradiction rather than the general
    binding question. (§4a)
21. **Legacy packages published with no `license` field.** 13 packages have published for
    years with no licence grant at all, which is ordinarily "all rights reserved" and
    almost certainly not intended. Is a clarifying statement advisable, and does making it
    carry risk? (`NOTICE-AND-PACKAGING.md` §3, Q-P3)
22. **Scope of Group A.** Should internal and build-time packages (`utils`, `utils-dev`,
    `peer-deps`, `framework-toolkit`) be relicensed along with the shipped library
    surface? (`NOTICE-AND-PACKAGING.md` §3, Q-P1)
23. **Scope of `Evaluation`.** As drafted it permits internal trial only, which for a
    client-side library may not constitute a meaningful evaluation at all (§3). Should it
    permit limited external distribution — named pilot users, non-production deployments,
    or unrestricted distribution that must cease at day 30 — and can that be drafted
    without becoming a route to indefinite free production use? (§3)
24. **Commercial agreement questions.** `COMMERCIAL-LICENSE-NOTES.md` §13 carries eleven
    further questions (Q-C0 to Q-C10), including whether entity formation should precede
    signing anything (Q-C9), whether the agreement is standard terms subject to the AGB
    regime (Q-C8), and whether pricing works against the customer's free fallback of
    running two-year-old releases (Q-C10).

---

## 13. What I am least confident in

Ordered by how much damage an error would do.

1. **`Application Users` (§4a).** It is the most important clause in the document — the
   requirements say getting it wrong "breaks the product" — and it is the one with no
   precedent to copy. The direct-grant construction is sound in principle, but I cannot
   tell you whether a court would treat a grant to an unidentified class of future
   recipients, made through a document those recipients never see, as effective. It may
   need to be restructured as an express third-party-beneficiary provision, or as an
   irrevocable offer that recipients accept by use. That is beyond what I can judge.
2. **`No Liability` (§10).** Untested plain-English wording against a statutory
   requirement that names specific words — and now with a second, German-law dimension
   that neither variant addresses.
3. **The anti-circumvention test in `Your Application` (§4a).** Deliberately loose. I
   know it is loose. I could not find a formulation that was both tight and did not
   catch legitimate cases.
3. **The investment limb (§5).** Moved up from where it would otherwise sit, because it
   has **no precedent anywhere** — not in the PolyForm family, FSL, BUSL, SSPL, Elastic
   or Statiq. Every existing size-gated licence gates on headcount and revenue; I found
   none gating on capital raised. The venture-debt-versus-ordinary-borrowing line is the
   softest boundary, and the permanence of the cumulative measure is the harshest
   consequence. Both are deliberate, and both are first attempts rather than adaptations.
4. **The anti-circumvention test in `Your Application` (§4a).** Deliberately loose. I
   know it is loose. I could not find a formulation that was both tight and did not
   catch legitimate cases.
5. **Whether the four independent permitted purposes read as independent.** They are
   separate sections each ending "is use for a permitted purpose", which is the source
   licences' own pattern for exactly this. But a reader who arrives at `Eligible
   Organizations` and stops might conclude the gate is universal. The new
   `Who May Use This Software For Free` signpost substantially mitigates this — it was
   added for prominence but it also fixes this — at the cost of the summary-versus-
   operative risk discussed at §11.
6. **Length.** With one option chosen the operative text lands around 1,850 words against
   the source's ~550. Roughly 400 of the increase is the three-limb gate and the
   investment definition; the rest is the added permitted purposes, the two
   library-specific clauses, and the conversion. Every part traces to a requirement.
   Length is a defect in this genre and I would welcome cuts, but I could not find any
   that did not drop something the project asked for.

---

## 14. Sources

Licence texts, taken from release tags in the publisher's source repository rather than
their website, which is currently 404ing (§2):

- `https://raw.githubusercontent.com/polyformproject/polyform-licenses/Polyform-Small-Business-1.0.0/Polyform-Small-Business.md`
- `https://raw.githubusercontent.com/polyformproject/polyform-licenses/Polyform-Noncommercial-1.0.0/Polyform-Noncommercial.md`
- `https://raw.githubusercontent.com/polyformproject/polyform-licenses/Polyform-Free-Trial-1.0.0/Polyform-Free-Trial.md`

Terms on which those texts are themselves licensed — checked at three refs, identical at
each (§2):

- `https://raw.githubusercontent.com/polyformproject/polyform-licenses/1.0.0/README.md`
- `https://raw.githubusercontent.com/polyformproject/polyform-licenses/Polyform-Small-Business-1.0.0/README.md`
- `https://raw.githubusercontent.com/polyformproject/polyform-licenses/master/README.md`

Conversion mechanism, both candidates compared at §7:

- `https://raw.githubusercontent.com/polyformproject/polyform-countdown/v1.0.0/form.md`
  — PolyForm Countdown License Grant 1.0.0, the per-release-document mechanism (not
  adopted; its framing sentences were)
- `https://raw.githubusercontent.com/getsentry/fsl.software/main/FSL-1.1-ALv2.template.md`
  — FSL 1.1, "Grant of Future License" (structure adopted)
- `https://fsl.software/` — FSL FAQ, source of the renaming condition discussed at §7

Precedent for this exact adaptation:

- `https://github.com/statiqdev/Statiq/blob/main/LICENSE.md` — Statiq Public License
  1.0.0, combining the same three sources with modified thresholds (10 individuals /
  USD 100,000)

The publisher's current working draft, consulted for the new-company rule (§5), the
30-day trial period, and current wording directions:

- `https://raw.githubusercontent.com/polyformproject/license-development/main/template.erb.md`
- `https://raw.githubusercontent.com/polyformproject/license-development/main/licenses.yml`

Origin of the CC-BY-4.0 claim (§2):

- `https://scancode-licensedb.aboutcode.org/polyform-noncommercial-1.0.0.html` — footer
  licences the ScanCode database, not the licence texts

Website availability (§2):

- `https://polyformproject.org/` — 200; `/licenses`, `/about`, and each licence URL — 404
  as of 2026-07-27
- `http://web.archive.org/web/20260717100234/https://polyformproject.org/licenses` — live
  in the 2026-07-17 snapshot

Trademark (§2):

- `https://tsdr.uspto.gov/#caseNumber=88400646&caseType=SERIAL_NO&searchType=statusSearch`

Package inventory (`NOTICE-AND-PACKAGING.md` §1) — npm registry, queried 2026-07-27:

- `https://registry.npmjs.org/-/org/livestore/package` — authoritative scope membership,
  **39 packages**
- `https://registry.npmjs.org/<pkg>` per package, for the `latest` dist-tag, its
  `license` field, publish date and deprecation status

A note on method, because it changed the answer. My first pass used `npm search`, which
returned 38 names and silently omitted `@livestore/devtools-react` — a package I already
knew existed. Anything built on that listing would have left packages unrelicensed
without any error. The org endpoint is the one to use, and
`NOTICE-AND-PACKAGING.md` §8 step 6 says to re-run it immediately before launch. The
scope had grown by 18 packages beyond what the requirements document records, so it
should be assumed to move again.

Upstream of the excluded package:

- `https://github.com/rhashimoto/wa-sqlite` — MIT © 2023 Roy T. Hashimoto

Individual-grant defect, as recorded in the requirements:

- `https://github.com/polyformproject/polyform-licenses/issues/58`
