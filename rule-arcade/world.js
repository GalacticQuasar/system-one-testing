// Objects and rules for the rule-changing arcade. No DOM, shared by the page,
// the agent and the bench.
//
// The model only ever sees the rule text and a plain description of each
// object ("a large blue fish, moving slowly"). The `truth` functions below are
// for scoring; they are never shown to the model.

// Noun attributes. `kitchen` = something you'd normally find in a kitchen.
export const NOUNS = {
  apple:    { edible: 1, natural: 1, kitchen: 1, shape: 'circle' },
  banana:   { edible: 1, natural: 1, kitchen: 1, shape: 'circle' },
  cake:     { edible: 1, kitchen: 1, shape: 'circle' },
  egg:      { edible: 1, natural: 1, kitchen: 1, shape: 'circle' },
  mushroom: { edible: 1, natural: 1, shape: 'circle' },
  fish:     { edible: 1, animal: 1, natural: 1, kitchen: 1, shape: 'triangle' },
  cat:      { animal: 1, natural: 1, shape: 'triangle' },
  bird:     { animal: 1, natural: 1, shape: 'triangle' },
  frog:     { animal: 1, natural: 1, shape: 'triangle' },
  bee:      { animal: 1, natural: 1, dangerous: 1, shape: 'triangle' },
  coin:     { metal: 1, valuable: 1, shape: 'square' },
  key:      { metal: 1, shape: 'square' },
  wrench:   { metal: 1, shape: 'square' },
  spoon:    { metal: 1, kitchen: 1, shape: 'square' },
  bomb:     { metal: 1, dangerous: 1, shape: 'star' },
  knife:    { metal: 1, kitchen: 1, dangerous: 1, shape: 'star' },
  skull:    { dangerous: 1, shape: 'star' },
  cactus:   { natural: 1, dangerous: 1, shape: 'star' },
  gem:      { natural: 1, valuable: 1, shape: 'diamond' },
  crown:    { metal: 1, valuable: 1, shape: 'diamond' },
  feather:  { natural: 1, shape: 'diamond' },
  book:     { shape: 'diamond' },
  shoe:     { shape: 'diamond' },
};

export const COLORS = {
  red: '#e5484d', blue: '#3e8ef7', green: '#30a46c', yellow: '#e6b800', purple: '#8e4ec6',
};

// Each rule: text the model reads, plus the ground-truth label for an object.
// Labels: 'collect' | 'avoid' | 'ignore'. The model is only offered the labels a
// rule actually uses (see `labelsFor`); the game knows which moves a wave allows,
// just not which object gets which.
export const RULES = [
  { text: 'Collect anything red. Avoid everything else.',
    truth: o => o.color === 'red' ? 'collect' : 'avoid' },
  { text: 'Collect things you could eat. Avoid anything that is not food.',
    truth: o => NOUNS[o.noun].edible ? 'collect' : 'avoid' },
  { text: 'Avoid animals. Collect everything else.',
    truth: o => NOUNS[o.noun].animal ? 'avoid' : 'collect' },
  { text: 'Collect anything made of metal. Ignore everything else.',
    truth: o => NOUNS[o.noun].metal ? 'collect' : 'ignore' },
  { text: 'Avoid anything dangerous. Collect anything valuable. Ignore the rest.',
    truth: o => NOUNS[o.noun].dangerous ? 'avoid' : NOUNS[o.noun].valuable ? 'collect' : 'ignore' },
  { text: 'Collect blue and green things. Avoid yellow things. Ignore all other colors.',
    truth: o => ['blue', 'green'].includes(o.color) ? 'collect' : o.color === 'yellow' ? 'avoid' : 'ignore' },
  { text: 'Avoid purple things. Collect anything that is not purple.',
    truth: o => o.color === 'purple' ? 'avoid' : 'collect' },
  { text: 'Collect small things. Avoid large things.',
    truth: o => o.size === 'small' ? 'collect' : 'avoid' },
  { text: 'Avoid anything moving fast. Collect anything moving slowly.',
    truth: o => o.fast ? 'avoid' : 'collect' },
  { text: 'Collect animals, unless they are red. Avoid red animals. Ignore everything that is not an animal.',
    truth: o => !NOUNS[o.noun].animal ? 'ignore' : o.color === 'red' ? 'avoid' : 'collect' },
  { text: 'Collect things found in nature. Avoid man-made things.',
    truth: o => NOUNS[o.noun].natural ? 'collect' : 'avoid' },
  { text: 'Opposite day: avoid food, and collect anything you cannot eat.',
    truth: o => NOUNS[o.noun].edible ? 'avoid' : 'collect' },
  { text: 'Collect anything you would find in a kitchen. Avoid everything else.',
    truth: o => NOUNS[o.noun].kitchen ? 'collect' : 'avoid' },
  { text: 'Collect yellow food and red animals. Avoid everything else.',
    truth: o => (o.color === 'yellow' && NOUNS[o.noun].edible) || (o.color === 'red' && NOUNS[o.noun].animal) ? 'collect' : 'avoid' },
];

export function labelsFor(rule) {
  const order = ['collect', 'avoid', 'ignore'];
  return order.filter(l => / ignore /i.test(` ${rule.text} `) || l !== 'ignore');
}

export function describeObject(o) {
  return `a ${o.size} ${o.color} ${o.noun}, moving ${o.fast ? 'fast' : 'slowly'}`;
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export function randomTraits() {
  return {
    noun: pick(Object.keys(NOUNS)),
    color: pick(Object.keys(COLORS)),
    size: Math.random() < 0.5 ? 'small' : 'large',
    fast: Math.random() < 0.35,
  };
}
