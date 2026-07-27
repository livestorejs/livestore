# Commercial licence — what it must cover

**Draft prepared for legal review. This is not legal advice.** These are notes for
counsel, not licence text. They describe what the separate commercial agreement has to
say so that it fits together with `LICENSE.md` without gaps or contradictions.

Nothing here is a settled decision except where it restates a requirement from
`../licence-requirements.md`. Everything else is a question with a recommendation.

---

## 1. Why this document exists

`LICENSE.md` gates use by organisations that fail any of its three eligibility limbs. It
does **not** say how such an organisation gets permission — only that they need it. The
requirements are explicit that this is a shipping blocker:

> A commercial licence must exist before the change ships — price, term, seat or org
> basis, purchase path. Without it the gate turns organisations into non-users rather
> than customers, and silently.

So the commercial agreement has to exist and be purchasable on the day the licence
change lands, not after.

**Settled inputs from the project**, which the agreement must reflect:

- Licence name: **LiveStore Community License 1.0**
- Licensor: **Johannes Schickling**, a natural person, with stated intent to assign to an
  entity later (see §12)
- Governing law and forum for the **commercial** agreement: **German law, courts of
  Berlin**. The public licence is deliberately silent on both.
- Every release converts to Apache-2.0 two years after its own publication (see §2)
- No audit rights anywhere in the public licence — enforcement is pure honour system

---

## 2. What the customer is actually buying — read this before pricing

The two-year conversion changes the product fundamentally, and the pricing model has to
be built around it rather than bolted on afterwards.

**A customer is buying a time-limited head start, not permanent access.** Every version
becomes Apache-2.0 on its own second anniversary. An organisation that fails the
eligibility gate has a standing free alternative: use only releases that are more than
two years old. That option is always available, always legal, and costs nothing.

So the commercial licence sells exactly one thing: **the right to use recent releases.**
Everything else is already free or becomes free on a published schedule.

Consequences that should shape the agreement and the price:

- **Nobody will pay enterprise-software prices for this.** The customer's downside if
  they refuse to buy is running two-year-old software, not being unable to use LiveStore
  at all. Price against that alternative, not against a total-denial scenario.
- **It strengthens the Model A recommendation in §6 almost to the point of making the
  choice obvious.** Granting a perpetual right to versions obtained during the term costs
  the licensor very little, because those versions convert to Apache-2.0 anyway within
  two years of their release. Model A is nearly free to offer and removes the customer's
  single biggest objection.
- **Renewal pressure comes from wanting current releases**, not from a threat of losing
  what they have. That is a healthier commercial dynamic and should be how the agreement
  and the sales material talk about it.
- **Say the conversion out loud in the agreement.** A customer who discovers it later
  feels sold-to; a customer who is told up front reads it as unusually fair. It is a
  genuine differentiator against BUSL-style licences with four-year terms.

**Question for counsel (Q-C0):** should the commercial agreement restate the conversion,
or incorporate it by reference to `LICENSE.md`? Restating risks the two drifting apart on
a later revision; silence risks a customer arguing they were not told.

---

## 3. The one structural constraint that cannot be got wrong

LiveStore is a **client-side library that ships inside other people's applications**.
`LICENSE.md` handles this with the [Application Users] clause: end users of a
licensee's application get their licences **directly from the licensor**, not by
sublicence, and those licences survive the licensee's own licences ending.

**The commercial agreement must do the same thing, and must not contradict it.**

Concretely, the commercial agreement must:

- Grant the customer the right to include the software in the customer's own products
  and distribute those products.
- Grant, or preserve, the direct-from-licensor licence to the customer's end users, on
  the same "no separate licence needed" basis.
- **Not** contain a blanket "no sublicensing, no distribution to third parties" clause
  of the kind that is standard in commercial software agreements. That clause is
  correct for a hosted service and wrong here. It would make the paid licence *worse*
  than the free one, which is the single most damaging drafting error available in this
  document.
- Say what happens to already-shipped applications when the agreement ends. See §6.

---

## 4. Seat, organisation, or something else

| Basis | Fits LiveStore? | Notes |
| --- | --- | --- |
| **Per developer seat** | Partly | Matches how DevTools is used (a developer's machine). Does not match the engine, which is a build-time dependency touched by everyone on a team and by CI. Creates a counting problem the licensor cannot verify and the customer resents. |
| **Per organisation (site licence)** | **Recommended** | One price per company (including affiliates, matching the `Your company` definition in `LICENSE.md`), covering unlimited developers and unlimited applications. Simple to sell, simple to comply with, and there is nothing to count. |
| **Per application / per product** | No | Invites disputes about what counts as one application, and penalises exactly the customers who adopt most deeply. |
| **Per end user of the customer's app** | No | Directly contradicts [Application Users]. Do not consider. |
| **Revenue-banded organisation licence** | Possible refinement | Same as per-organisation, with two or three price bands keyed to the same revenue definition already used in `LICENSE.md`. Reuses a definition the customer has already had to apply to know they need a licence at all. |

**Recommendation:** per-organisation, optionally revenue-banded, with the organisation
defined by reference to the same `Your company` / `Control` definitions as
`LICENSE.md`, so a customer never has to apply two different tests.

**Question for counsel (Q-C1):** should the definition of the customer's organisation
be repeated verbatim in the commercial agreement, or incorporated by reference to
`LICENSE.md`? Incorporation by reference is cleaner but couples the paid agreement to a
document the licensor can revise unilaterally.

---

## 5. Term and renewal

Recommended shape:

- **Term:** one year, from the date of purchase.
- **Renewal:** automatic annual renewal unless either side gives notice before the
  renewal date, with a stated notice period. Alternative: expiry with no auto-renewal,
  which is friendlier and worse for revenue predictability.
- **Price at renewal:** state whether the renewal price is the price at purchase or the
  then-current list price. If the latter, cap the increase.
- **What the term buys:** see §6 — this is the important part.

**Question for counsel (Q-C2):** whether auto-renewal is enforceable and appropriate
across the likely customer jurisdictions, and what notice is required.

---

## 6. What happens when the licence lapses — the central decision

Two coherent models. They are genuinely different products and the choice should be
deliberate.

### Model A — perpetual licence, time-limited updates

The customer buys a **perpetual** right to use the versions released during the term.
When the term ends they keep those versions forever, and simply stop receiving the
right to use newer versions.

- Customer risk on lapse: none. Shipped products keep working, legally and technically.
- Licensor risk: a customer can buy one year and never renew.
- Prior art: this is how most developer-tool licences of this shape work.

### Model B — subscription, rights end on lapse

The right to use the software ends with the term.

- Customer risk on lapse: severe, and for a library embedded in shipped applications,
  close to unsellable. A customer whose licence lapses is retroactively infringing in
  every copy of their application already in users' hands.
- **This model cannot be reconciled with [Application Users] without a carve-out** that
  preserves end-user licences for applications already distributed. Without that
  carve-out, lapse breaks the customer's customers.

**Recommendation: Model A**, and §2 makes this close to unarguable. A perpetual grant
over versions obtained during the term costs the licensor almost nothing, because those
versions become Apache-2.0 within two years of their release regardless. Model B asks the
customer to accept severe lapse risk in exchange for nothing the licensor actually needs.
Model A is also the only model consistent with the [Application Users] clause.

Whichever is chosen, the agreement must state explicitly:

1. Whether the customer may keep using versions obtained during the term.
2. Whether applications already distributed remain licensed — this must be **yes**
   under either model.
3. Whether the customer may continue to distribute *new copies* of an application built
   on a version obtained during the term. Recommend **yes** under Model A.
4. Whether a lapsed customer who later comes back within all three eligibility limbs
   simply returns to `LICENSE.md`. Recommend **yes**, stated plainly. Note this is now
   less likely to happen than under a two-limb gate: the investment limb counts
   cumulatively across the customer's whole history and never resets, so a customer who
   failed on investment can never become eligible again. Say so rather than implying a
   route back that does not exist.
5. That the customer keeps the Apache-2.0 rights that have already vested on versions
   more than two years old. Nothing in the commercial agreement should appear to take
   those away, and a customer's lawyer will check.

---

## 7. Enforcement, given there is no technical enforcement

The requirements settle this: enforcement is contractual only, and no licence-key or
runtime validation mechanism ships. The commercial agreement therefore carries the
whole enforcement burden, and should include:

- A statement that the customer is responsible for assessing whether it qualifies under
  `LICENSE.md`, and for notifying the licensor when it stops qualifying.
- A **retroactive-purchase** term: an organisation that discovers it has been using the
  software above the threshold without a licence can cure by purchasing, at list price,
  for the period of unlicensed use. This is worth having; it converts an awkward
  conversation into a sale and is far cheaper than litigation.
- Whatever verification right counsel thinks appropriate. **The public licence has none
  at all** — this was settled deliberately (see `REVIEW-NOTES.md` §8), so the commercial
  agreement is the only place any verification can live. A *paid, signed* agreement can
  reasonably carry a right that a free public licence should not, but it must not be
  drafted so as to imply the free licence carried one.

---

## 8. Purchase path — must exist at launch

Not a legal question, but the requirements make it a launch blocker. The agreement text
needs to match whatever the purchase mechanism actually is:

- Self-serve checkout, or invoice, or both.
- Whether purchase is by click-through acceptance (in which case the agreement must be
  drafted as a click-through, with the acceptance mechanics counsel requires) or by
  signature.
- Whether GitHub Sponsors tiers can grant a commercial licence. There is precedent for
  this pattern, but a sponsorship tier description is a thin place to hang a licence
  grant; if used, the tier must point at this agreement rather than restate it.

---

## 9. Migration commitments to honour

From `../licence-requirements.md` §7. These are commitments already made publicly, and
the commercial agreement or its surrounding policy should say how each is honoured:

1. **Existing sponsors** were promised a DevTools licence as a published benefit. Decide
   and state the honoured window — indefinitely, or for a stated period.
2. **Students** receive free licences on request. If the [Personal Uses] clause in
   `LICENSE.md` is adopted as drafted, this is fully subsumed and no separate student
   programme is needed. Say so publicly so the promise is visibly kept.
3. **Existing DevTools activations** under the retired key system persist until the
   grace period ends. State the grace period end date.

---

## 10. Things this agreement should *not* contain

Each of these would contradict a settled requirement:

- **A non-compete or competing-use restriction.** Deliberately excluded. Nobody can host
  a client-side SQLite library, and the project has committed not to offer a hosted
  service.
- **A source-disclosure obligation.** Not an objective.
- **Any reference to licence keys, activation, or runtime validation.** The mechanism is
  being retired; referencing it would reanimate it contractually.
- **A clause purporting to affect releases that have already converted to Apache-2.0.**
  This is now a *moving* set, not a fixed one: it includes everything published before
  `{{FIRST_COVERED_VERSION}}`, plus every covered release more than two years old, and it
  grows every day. Those grants are perpetual and irrevocable and cannot be clawed back.
  Draft the agreement so it addresses the customer's rights in *current* releases and is
  silent on converted ones, rather than trying to enumerate a boundary that moves.
- **An audit or inspection right that reaches back into the public licence.** The public
  licence deliberately has none. A verification term in a *paid, signed* agreement is a
  different matter and is fine (§7), but it must not be drafted so as to imply the free
  licence carried one.

---

## 11. Governing law and forum — this is where they live

The public licence is **deliberately silent** on governing law and forum, matching
Apache-2.0, MIT, and every widely used source-available licence. That silence is a
decision, not an omission (see `REVIEW-NOTES.md` §11).

The commercial agreement is the right home for both, because it is negotiated and
signed rather than offered to the world.

**Settled: German law, courts of Berlin.**

Points for counsel:

- **Mandatory consumer and small-business protections may override the choice.** German
  and EU rules on standard terms (AGB, §§305–310 BGB) apply with real force to
  non-negotiated agreements and can strike clauses that a US-style agreement takes for
  granted — particularly broad liability exclusions. If the commercial agreement is sold
  self-serve as standard terms rather than negotiated, expect the AGB regime to apply,
  and draft the liability section for it rather than importing US wording.
- **The liability position cannot simply mirror `LICENSE.md`.** German law does not
  permit excluding liability for intent or gross negligence, or for injury to life, body
  or health, however the clause is worded. Whatever is chosen for the public licence's
  `No Liability` section, the commercial agreement needs its own German-law-compliant
  version. This connects to Q-C7.
- **A Berlin forum clause is straightforward against business customers** and much less
  reliable against consumers or very small businesses in other EU states. If any
  customers might be consumers, the clause should be drafted to yield where mandatory
  rules require.
- **Non-EU customers** — particularly US enterprises — routinely resist foreign
  governing law. Decide in advance whether this is negotiable for larger deals, because
  it will be asked.

**Question for counsel (Q-C8):** should the agreement be structured as negotiated terms
or as standard terms (AGB)? The answer changes how much of it survives review, and it is
better decided before drafting than discovered afterwards.

---

## 12. The licensor is a natural person

`{{LICENSOR}}` resolves to **Johannes Schickling**, an individual, with a stated
intention to assign the rights to an entity later. Three consequences for the commercial
agreement:

- **Business and personal liability are mixed.** A natural person signing commercial
  software agreements carries the obligations personally, with no corporate veil. Given
  that the agreements will contain warranty and possibly indemnity terms (Q-C6), and
  that German law limits how far liability can be excluded, this is a real exposure and
  not a formality. Counsel should advise on whether to form the entity **before** signing
  any commercial agreements rather than after.
- **A later assignment means novating or notifying existing customers.** Copyright can be
  assigned and the assignee takes subject to existing licences, so the *public* licence
  needs nothing (see `REVIEW-NOTES.md` §12). But signed commercial agreements are
  contracts, and moving the licensor's side of them to a new entity may require customer
  consent depending on how they are drafted. **Include an assignment clause permitting
  assignment to a successor entity without customer consent, in every commercial
  agreement from the first one.** Retrofitting this across a customer base is painful;
  including it costs nothing.
- **Name the licensor consistently.** The public licence identifies the licensor
  generically and carries the name only in a `Required Notice:` line, precisely so that
  an assignment does not require re-issuing the licence text. The commercial agreement
  should name the party explicitly, as contracts must.

**Question for counsel (Q-C9):** should entity formation precede the licence change, or
can commercial agreements be signed personally in the interim with an assignment clause
carrying them across later?

---

## 13. Open questions for counsel

- **Q-C0** — Should the agreement restate the two-year Apache-2.0 conversion, or
  incorporate it by reference to `LICENSE.md`? (§2)
- **Q-C1** — Organisation definition: repeat verbatim or incorporate by reference? (§4)
- **Q-C2** — Auto-renewal enforceability and notice requirements. (§5)
- **Q-C3** — Model A vs Model B. Recommendation is A; confirm. (§6)
- **Q-C4** — Is the retroactive-purchase cure term enforceable, and does offering it
  weaken any later claim for the unlicensed period? (§7)
- **Q-C5** — If purchase is click-through, what acceptance mechanics are needed for the
  agreement to bind, and does that differ across target jurisdictions? (§8)
- **Q-C6** — Does a commercial customer need an indemnity from the licensor, and is the
  project willing to give one? Customers who fail any eligibility limb will ask. The answer
  affects pricing and is currently undecided.
- **Q-C7** — Should the commercial agreement include a warranty and liability position
  different from `LICENSE.md`'s? A paying customer may not accept a bare "as is", and a
  large one certainly will not. Under German law it cannot simply mirror it in any case
  — see §11.
- **Q-C8** — Negotiated terms or standard terms (AGB)? The answer determines how much of
  the agreement survives review under §§305–310 BGB. (§11)
- **Q-C9** — Should entity formation precede the licence change, or can agreements be
  signed personally in the interim with an assignment clause? (§12)
- **Q-C10** — Pricing must be set against the customer's free fallback of running
  releases more than two years old, not against total denial of access. Is that fallback
  acceptable commercially, or does it argue for a longer conversion period? Note the
  two-year period is settled; this question is about whether the *pricing* built on it
  works, not about reopening it. (§2)

[Application Users]: ./LICENSE.md#application-users
[Personal Uses]: ./LICENSE.md#personal-uses
