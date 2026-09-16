# Learn With Why — the floating-island edition

`dist/index.html` is the site from the reference video: the 960 landscape frames
travel between six chapters, every surface on top is glass, and the fox and
rabbit from `preview-frames/` play inside chapter 02.

One file, no build step. Serve `dist/` with `node server.cjs` and open
http://127.0.0.1:4173 (use a server — the frames are fetched, not inlined).

## Chapters

| # | Nav | What is there |
|---|-----|---------------|
| 01 | Get started | "Every great adventure begins with *why*." + glass card with **Sign up / Sign in** tabs, forgot-password code flow. Demo accounts live in this browser. |
| 02 | Sheets | "A moment of *wonder*." — the player: fox & rabbit preview (Pause preview), a glass card per sheet, ← dots → carousel, *Explore this sheet* opens the paper modal. |
| 03 | Worksheets | "Grow a little. *Every day*." — filter chips (All / Maths / Phonics / Stories / Nature) and a row of paper cards (`2 + 3` Woodland addition, `Once…` My first story, …). |
| 04 | About us | two glass panels + stats. |
| 05 | Contact us | "A little question? A big *idea*?" + *Leave a little note* form (demo). |
| 06 | Testimonials | 3D coverflow of white quote cards, ← 1/3 →, Pause, "A new adventure starts here →". |

Chrome: white logo tile (the tree in a crescent), nav pill with **Bag (n)**, bottom-left
`01 / Get started`, bottom-centre **Scroll to discover**, bottom-right *Learn With Why*.

## Commerce

Every sheet and worksheet opens a paper modal (age range, subject, licence, price).
Free access sheets → **Unlock for free**; paid ones → **Pay now** or **Add to bag**
(licence type sets the price and the print allowance). Both need an account: a guest
is taken to chapter 01 and the action completes right after sign-in. Unlocked items
show *Unlocked ✓* everywhere and print as an A4 page with a licence line.
**Payment is a demo** — nothing is charged.

## Editing

Everything visible is at the top of the `<script>`: `NAV`, `SHEETS`, `WORKSHEETS`,
`CATS`, `QUOTES`, `LICENCES` (price `0` = free access sheet). Copy for the chapters is
in the HTML. Fonts: Cormorant Garamond (headings) and Inter (UI), both in `fonts/`.
