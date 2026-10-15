// The System One agent: one `choice` question per (object, rule) pair.
// The state is just facts: the rule text and the object's description.
// Nothing about what to do is pre-computed by the harness.

import { describeObject, labelsFor } from './world.js';

export const MODEL = 'tev1:0.8b';

const CRITERIA = {
  collect: 'Collect it: the rule says to collect this object',
  avoid: 'Avoid it: the rule says to avoid this object',
  ignore: 'Ignore it: the rule says to ignore this object',
};

export function questionsFor(rule) {
  return {
    action: {
      type: 'choice',
      instructions:
        'You are playing an arcade game with a rule that changes every wave. ' +
        'Following the current rule exactly, what should the player do with this object?',
      criteria: Object.fromEntries(labelsFor(rule).map(l => [l, CRITERIA[l]])),
    },
  };
}

export function stateText(ruleText, o) {
  return `Current rule: "${ruleText}"\nObject: ${describeObject(o)}.`;
}

export class Agent {
  constructor({ endpoint, model }) {
    this.endpoint = endpoint;
    this.model = model || MODEL;
    this.calls = 0;
  }

  async classify(rule, o) {
    const state = stateText(rule.text, o);
    const t0 = performance.now();
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, state, questions: questionsFor(rule) }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const a = (await res.json()).answers.action;
    this.calls++;
    return { state, ms: performance.now() - t0, label: a.choice, confidence: a.confidence, probabilities: a.probabilities };
  }

  // The first few calls are slow while the model loads and warms its cache.
  async warmup(rule, n = 3) {
    const o = { noun: 'apple', color: 'red', size: 'small', fast: false };
    for (let i = 0; i < n; i++) await this.classify(rule, o);
  }
}
