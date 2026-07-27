# Review notes for counsel

**This is a draft prepared for legal review. It is not legal advice, and it was not
prepared by a lawyer.** Every clause below is offered as a starting point for your
review, not as a settled position.

Purpose of this document: to save you the work of reverse-engineering intent. It records
what each clause is for, where the draft departs from its source and why, what is
unverified, and what I could not resolve. §12 is the numbered list of open questions.
§13 states what I am least confident in.

**Read §2 first.** It corrects a factual premise I was given, and it constrains the
licence text.

---

## 1. What the licence has to achieve

From the settled requirements (`../licence-requirements.md`), which I treated as fixed:

- Free use if **fewer than 10 individuals AND less than USD 1,000,000 revenue** in the
  prior tax year. Conjunctive, deliberately. Fixed figure, **not** inflation-indexed.
  Affiliates aggregate.
- Unconditional grants regardless of that gate for: individuals, noncommercial and public
  organisations, and a ~30-day evaluation.
- Modification and redistribution as part of the licensee's own application permitted.
- **Downstream recipients of a licensee's application must not need their own licence.**
- No non-compete. No source-disclosure obligation. No technical enforcement.
- Future releases only; prior releases stay Apache-2.0 irrevocably.
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

## 2a. Placeholder inventory — including three the brief did not list

The brief specified `{{LICENCE_NAME}}`, `{{LICENSOR}}`, `{{GOVERNING_LAW}}`,
`{{SUNSET}}`, `{{AUDIT_RIGHTS}}`, `{{REVENUE_DEFINITION}}` and
`{{INDIVIDUALS_DEFINITION}}`. All appear in the draft. I added **three more**, each
because the text is unusable without it. Flagged here rather than slipped in:

| Placeholder | Why it exists |
| --- | --- |
| **`{{LICENCE_URL}}`** | The `Notices` clause obliges recipients to get the terms *or the URL for them*. Removing the source publisher's URL under the de-branding condition (§2) leaves nothing there. A project-hosted canonical URL must exist and resolve before the first covered release. |
| **`{{LICENSOR_URL}}`** | Appears only in the `Required Notice:` example line, mirroring the source licences' own example format. Cosmetic; can be dropped with the example if the `Required Notice:` mechanism is not used. |
| **`{{VENUE}}`** | Only inside the optional `Governing Law` section. Governing law and forum are separate choices and conflating them into one placeholder would hide that. Disappears entirely if §11's recommendation to omit that section is accepted. |

Two further placeholders, `{{SUNSET_PERIOD}}` and `{{SUNSET_LICENCE}}`, sit inside the
`{{SUNSET}}` variant block and are needed only if that variant is chosen. `LICENSE.md`
also references `{{LICENCE_ID}}` indirectly through `NOTICE-AND-PACKAGING.md`, which is
the SPDX `LicenseRef-` identifier and is not part of the licence text itself.

I invented no substantive figures, names, periods or jurisdictions anywhere. The only
concrete numbers in the operative text are those the requirements fix (10 individuals,
USD 1,000,000), the 32-day cure period inherited unchanged from the source, and the
30-day evaluation and certification-response periods discussed at §3 and §8.

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

## 5. The size gate

Drafted from the small-business licence's `Small Business` clause with these changes:

- **Thresholds:** 100 → **10** individuals; 1,000,000 USD retained but its meaning
  changed, see next point.
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
- **Conjunctive test made explicit.** The source's "and" is easy to skim past, so the
  draft adds "Your company must meet both of these. If it meets only one, use for its
  benefit is not a permitted purpose under this section." The requirements are emphatic
  that a five-person company at USD 3M revenue is meant to be gated.
- **New-company case added.** The source has no rule for a company with no prior tax
  year, which is undefined for a large share of the target audience — the gate simply
  has no answer for them. The draft permits use during the first tax year until either
  figure is passed. This is not in the requirements, but the gate is incomplete without
  it, so I trace it to the gate requirement rather than treating it as an addition. The
  publisher's own later working draft adopts the same approach, which I take as
  confirmation it is the conventional fix. **Confirm this is wanted — see Q6.**
- **Affiliate roll-up** comes free from the source's `Your company` / `Control`
  definitions, which the draft keeps essentially verbatim. Nothing was added.

### An open item from the requirements that I believe is now answered

Requirements open item 5 asks whether the individual grant should extend to sole traders
and single-person companies. **I think the definitions already settle it and it does not
need to go to you as an open question.** The `Your company` definition expressly includes
"sole proprietorship", and `Personal Uses` expressly excludes work for an organization
including a client. So a sole trader doing client work falls to `Small Business` — where,
being one person under USD 1,000,000, they pass anyway. The outcome the requirement
wanted is reached without a special rule. Flagged here so you can disagree rather than
rediscover it.

---

## 6. `{{REVENUE_DEFINITION}}` — variants in the draft

Requirements open item 4. Left as a labelled variant block in the Definitions section
because it materially changes who is gated.

- **Variant A — undefined.** What the source licences do. Relies on ordinary meaning.
  Shortest, and consistent with the register, but leaves genuine ambiguity for grant-
  funded organisations and for pre-revenue funded startups.
- **Variant B — defined.** Gross (before costs), consolidated across the company and its
  affiliates and counted once, excluding equity investment, borrowing, grants and
  donations.

**Recommendation: Variant B.** The pre-revenue-funded-startup case is common in this
audience and Variant A gives no answer. Excluding investment means a seed-funded
five-person company with no product revenue qualifies, which I read as the intended
outcome given the requirement's stated rationale of ability to pay. Excluding grants
avoids double-gating organisations that `Noncommercial Organizations` already covers.
**Confirm the investment carve-out is intended — see Q7.**

---

## 7. `{{INDIVIDUALS_DEFINITION}}` — variants in the draft

Requirements open item 3. Three labelled variants:

- **A — undefined.** Source behaviour.
- **B — headcount, part-time counted in full.** Every individual counted once regardless
  of hours; agency workers count if they worked mainly for the company.
- **C — full-time equivalents.** Averaged FTE across the prior tax year.

**Recommendation: Variant B.** At a threshold of 10, FTE arithmetic is disproportionate
and creates a self-assessment burden bigger than the decision it informs. B is
conservative — it counts more people, so it gates more organisations — and is trivial to
apply. The agency sentence in B is the part I am least sure of: "worked mainly for your
company" is a soft test, and offshore agency arrangements are exactly where a licensee
would push. **See Q8.**

---

## 8. `{{AUDIT_RIGHTS}}` — variants in the draft

Requirements §5 asks counsel to advise. Two labelled variants:

- **A — nothing.** Rely on `Violations` and on the commercial agreement.
- **B — self-certification on request.** On written request the licensee confirms in
  writing, within 30 days, whether its use is permitted and under which section. Capped
  at one request per 12 months. No financial records. Never applies to `Personal Uses`.

**Recommendation: Variant B, but this is the clause I would most readily drop.** A
records-inspection audit right of the kind found in enterprise agreements is
disproportionate in a public licence for a client-side library and would be read as
hostile by exactly the developer audience the project depends on. Variant B is the
minimum that gives the licensor a documented request-and-response record. The
`Personal Uses` carve-out is there so an individual can never receive a compliance
letter. A *paid* agreement can reasonably carry more; see `COMMERCIAL-LICENSE-NOTES.md`
§6. **See Q9.**

---

## 9. `{{SUNSET}}` — variants in the draft

Being decided separately, so it is a labelled variant with placeholders left open.

- **A — none.** The terms apply indefinitely.
- **B — delayed permissive grant.** After `{{SUNSET_PERIOD}}`, each version also becomes
  available under `{{SUNSET_LICENCE}}`, with an optional `Change Date:` plain-text line
  to state the date exactly for a given release.

Drafting notes on B, which apply whichever period is chosen:

- The grant is **additive** — the licensee may then choose either set of terms. It does
  not replace the original grant, so nobody's existing rights shrink.
- It runs **per version, from first availability of that version**, matching the
  established convention for this pattern.
- It cascades to earlier versions ("that version, and every earlier version"), so a
  licensee never has to track more than one date.
- The `Change Date:` mechanism lets the project state an exact date per release rather
  than obliging every licensee to compute one. Recommended if B is chosen.

**Interaction worth noting:** if `{{SUNSET_LICENCE}}` is Apache-2.0, the project ends up
with Apache-2.0 on prior releases, the new licence on covered releases, and Apache-2.0
again after the sunset period. That is coherent, and probably reassuring to enterprise
adopters, but the announcement must be very clear or it will read as confusing. **See Q10.**

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

**I have deliberately not picked.** The choice is between fidelity to a plain-English
register that the whole document depends on, and defensive drafting. That is your call,
not mine. **See Q11.**

---

## 11. `{{GOVERNING_LAW}}` — included as optional, and I would leave it out

The source licences have **no** governing-law or venue clause at all, and no
public source-available licence in wide use has one. The draft includes a short optional
section so it is available if wanted.

**My view: omit it.** A public licence offered to the world is not a negotiated contract;
naming a forum invites the argument that it is one, and a venue clause is unlikely to
survive against a consumer or small business in an unfavourable jurisdiction anyway. It
also breaks register — it is the one section that reads like conventional contract
boilerplate. The place for governing law and venue is the **commercial agreement**, which
is negotiated and signed. **See Q12.**

---

## 12. Open questions — numbered

1. **De-branding scope.** I read the source publisher's condition ("remove all mention
   of [the family name] and [their domain]") as binding the modified licence text only,
   so `LICENSE.md` is clean but these notes discuss derivation freely. Is that right? If
   you read it more broadly, this document needs sanitising too. Related: is the
   condition a copyright term, a trademark term, or both, and does that change the
   answer? (§2)
2. **Breadth of `Personal Uses`.** I removed "without any anticipated commercial
   application" to admit portfolio work. Does the negative boundary sentence plus the
   `Your company` definition adequately stop a solo commercial developer relying on
   `Personal Uses` instead of `Small Business`? (§3)
3. **Patent defence and Application Users.** Application Users recipients get a patent
   licence with no defensive-termination hook, because `Patent Defense` binds only "you"
   and "your company". Is that acceptable, or should `Application Users` carry its own
   defensive-termination sentence at the cost of some of its no-agreement-needed
   simplicity? (§4a)
4. **Anti-circumvention in `Your Application`.** Is "substantial functionality of its own
   beyond the software" / "a product whose main value is the software itself" a
   workable test, and can it be tightened without excluding legitimate thin integration
   libraries? (§4a)
5. **Narrowed `Notices`.** Is accepting a third-party-notices file as compliance for
   bundled distribution acceptable, and does it weaken any later claim? (§4b)
6. **New-company rule.** Is permitting a company with no prior tax year to use the
   software during its first tax year, until it passes either figure, wanted? It is not
   in the requirements but the gate is undefined without it. (§5)
7. **Revenue definition.** Variant A or B; and if B, confirm that excluding equity
   investment and borrowing is intended, so a well-funded pre-revenue startup qualifies.
   (§6)
8. **Individuals definition.** Variant A, B, or C; and if B, is "worked mainly for your
   company" adequate for offshore agency arrangements? (§7)
9. **Audit rights.** Variant A or B, and is even the light self-certification in B
   appropriate in a public licence for a client-side library? (§8)
10. **Sunset.** If Variant B is chosen: what period, what target licence, and is the
    additive per-version cascading structure right? (§9)
11. **Warranty and liability.** Variant A or B. This is the clause most likely to be
    legally weaker in plain English than in conventional wording. (§10)
12. **Governing law.** Include or omit? Recommendation is omit from the public licence
    and put it in the commercial agreement. (§11)
13. **Enforceability of self-assessment.** Requirements open item 1, which I could not
    address in drafting. If a licensee self-assesses incorrectly in good faith, is the
    gate enforceable against them, and does the absence of any technical enforcement
    weaken the licensor's position? This affects whether Q9 should be answered A or B.
14. **Interaction with the surviving Apache-2.0 grant.** Requirements open item 6. My
    drafting position: state it plainly in the repo root `LICENSE` and the release notes,
    and keep it out of the operative licence entirely — the boundary is drawn by which
    text ships with which version. Confirm. (`NOTICE-AND-PACKAGING.md` §5)
15. **`wa-sqlite` fork copyright.** Does the fork contain enough original authorship for
    a second copyright line, and in whose name? (`NOTICE-AND-PACKAGING.md` §3)
16. **Acceptance mechanics.** `Acceptance` makes agreement both a strict obligation and a
    condition of the licences. For software installed by a package manager with no
    click-through, is that sufficient to bind, and does anything need to change now that
    a *paid* alternative exists behind the same gate? Note this is separate from the
    Application Users carve-out described at §4a(2), which fixes an internal
    contradiction rather than the general binding question. Not raised in the
    requirements; it occurred to me while drafting.
17. **Legacy packages published with no `license` field.** 13 packages have published for
    years with no licence grant at all, which is ordinarily "all rights reserved" and
    almost certainly not what was intended. Is a clarifying statement that those versions
    were and remain available under Apache-2.0 advisable, and does making it carry risk?
    (`NOTICE-AND-PACKAGING.md` §3, Q-P3)
18. **Scope of Group A.** Should internal and build-time packages (`utils`, `utils-dev`,
    `peer-deps`, `framework-toolkit`) be relicensed along with the shipped library
    surface? The requirements' "all published `@livestore/*` packages" says yes by
    default. (`NOTICE-AND-PACKAGING.md` §3, Q-P1)
19. **Commercial agreement questions.** `COMMERCIAL-LICENSE-NOTES.md` §10 carries seven
    further questions (Q-C1 to Q-C7), including indemnity and warranty position for
    paying customers, which is currently undecided and will affect pricing.

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
2. **`No Liability` (§10).** Explained above. Untested plain-English wording against a
   statutory requirement that names specific words.
3. **The anti-circumvention test in `Your Application` (§4a).** Deliberately loose. I
   know it is loose. I could not find a formulation that was both tight and did not
   catch legitimate cases.
4. **Whether the four independent permitted purposes read as independent.** They are
   separate sections each ending "is use for a permitted purpose", which is the source
   licences' own pattern for exactly this. But a reader who arrives at `Small Business`
   and stops might conclude the gate is universal. If you think that risk is real, a
   short orienting sentence before the four sections would fix it — I left it out to
   protect the register, which may have been the wrong trade.
5. **Length.** With one option chosen per variant block the operative text lands around
   1,200 words against the source's ~550. The extra is almost entirely the three added
   permitted purposes and the two library-specific clauses, all of which trace to
   requirements. Length is a defect in this genre and I would welcome cuts, but I could
   not find any that did not drop a required grant.

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
