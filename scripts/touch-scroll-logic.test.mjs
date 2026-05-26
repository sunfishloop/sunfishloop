/**
 * Unit checks for card scroll edge / absorb logic (mirrors app.js).
 * Run: node scripts/touch-scroll-logic.test.mjs
 */
function cardScrollEdges(card) {
  const edge = 12;
  const maxScroll = Math.max(0, card.scrollHeight - card.clientHeight);
  if (maxScroll <= edge) {
    return { atTop: true, atBottom: true, canScroll: false };
  }
  return {
    canScroll: true,
    atTop: card.scrollTop <= edge,
    atBottom: card.scrollTop >= maxScroll - edge
  };
}

function cardAbsorbsTouchScroll(card, deltaY) {
  const { atTop, atBottom, canScroll } = cardScrollEdges(card);
  if (!canScroll) return false;
  if (deltaY > 0) return !atBottom;
  if (deltaY < 0) return !atTop;
  return false;
}

function mockCard(scrollTop, scrollHeight, clientHeight) {
  return { scrollTop, scrollHeight, clientHeight };
}

const cases = [
  {
    name: "short card — swipe up paginates",
    card: mockCard(0, 100, 200),
    delta: 50,
    expectAbsorb: false
  },
  {
    name: "middle — swipe up scrolls card",
    card: mockCard(100, 500, 200),
    delta: 50,
    expectAbsorb: true
  },
  {
    name: "at bottom — swipe up paginates",
    card: mockCard(288, 500, 200),
    delta: 50,
    expectAbsorb: false
  },
  {
    name: "at top — swipe down paginates",
    card: mockCard(0, 500, 200),
    delta: -50,
    expectAbsorb: false
  },
  {
    name: "middle — swipe down scrolls card",
    card: mockCard(100, 500, 200),
    delta: -50,
    expectAbsorb: true
  }
];

let failed = 0;
for (const c of cases) {
  const got = cardAbsorbsTouchScroll(c.card, c.delta);
  const ok = got === c.expectAbsorb;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name} (absorb=${got})`);
  if (!ok) failed++;
}
process.exit(failed > 0 ? 1 : 0);
