import assert from 'node:assert/strict';
import test from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import { apply, inject, name } from '../lib/index.js';

function captureHandler() {
  let eventName;
  let handler;
  let registrations = 0;

  apply({
    on(event, listener, options) {
      if (event === 'agent/pre-step') {
        eventName = event;
        handler = listener;
        registrations += 1;
        assert.deepEqual(options, { prepend: true });
      }
      return () => {};
    },
  });

  assert.equal(registrations, 1);
  assert.equal(eventName, 'agent/pre-step');
  assert.equal(typeof handler, 'function');
  return handler;
}

test('exports the required Cordis plugin metadata', () => {
  assert.equal(name, 'dsh-silent-model-switch');
  assert.deepEqual(inject, []);
});

test('returns the original enter decision when there is nothing to filter', async () => {
  const handler = captureHandler();
  const messages = [
    { role: 'user', content: 'ordinary input' },
    {
      role: 'user',
      content: '旧模型 → 新模型',
      source: { kind: 'composer' },
    },
  ];
  const decision = { kind: 'enter', messages };
  let nextCalls = 0;

  const result = await handler({ messages }, async () => {
    nextCalls += 1;
    return decision;
  });

  assert.equal(nextCalls, 1);
  assert.strictEqual(result, decision);
  assert.strictEqual(result.messages, messages);
});

test('filters only model-selection sources and preserves order and identity', async () => {
  const handler = captureHandler();
  const first = { role: 'user', content: 'first' };
  const noticeA = {
    role: 'user',
    content: { kind: 'model-selection', form: 'notice', summary: 'A → B' },
    source: { kind: 'model-selection' },
  };
  const matchingTextOnly = {
    role: 'user',
    content: 'model-selection: A → B',
    source: { kind: 'composer' },
  };
  const lookalike = {
    role: 'user',
    content: 'lookalike source',
    source: { kind: 'model-selection-notice' },
  };
  const noticeB = {
    role: 'user',
    content: 'any representation',
    source: { kind: 'model-selection' },
  };
  const last = { role: 'user', content: 'last' };
  const messages = [first, noticeA, matchingTextOnly, lookalike, noticeB, last];
  const decision = {
    kind: 'enter',
    messages,
    startsRequestSeries: true,
  };

  const result = await handler({ messages }, async () => decision);

  assert.notStrictEqual(result, decision);
  assert.equal(result.kind, 'enter');
  assert.equal(result.startsRequestSeries, true);
  assert.deepEqual(result.messages, [first, matchingTextOnly, lookalike, last]);
  assert.strictEqual(result.messages[0], first);
  assert.strictEqual(result.messages[1], matchingTextOnly);
  assert.strictEqual(result.messages[2], lookalike);
  assert.strictEqual(result.messages[3], last);
  assert.equal(messages.length, 6, 'the downstream message array is not mutated');
});

test('enters with an empty message list when every message is a model-selection notice', async () => {
  const handler = captureHandler();
  const messages = [
    { role: 'user', source: { kind: 'model-selection' } },
    { role: 'user', source: { kind: 'model-selection' } },
  ];

  const result = await handler({ messages }, async () => ({
    kind: 'enter',
    messages,
  }));

  assert.deepEqual(result, { kind: 'enter', messages: [] });
});

test('does not replace a downstream reject decision', async () => {
  const handler = captureHandler();
  const decision = { kind: 'reject' };

  const result = await handler({ messages: [] }, async () => decision);

  assert.strictEqual(result, decision);
});

test('filters messages through a real Cordis waterfall dispatch', async () => {
  const ctx = new Context();
  const fiber = ctx.plugin({ name, inject, apply });
  await fiber;

  const keep = { role: 'user', content: 'keep me' };
  const remove = {
    role: 'user',
    content: 'A → B',
    source: { kind: 'model-selection' },
  };
  const messages = [keep, remove];

  try {
    const result = await ctx.waterfall(
      'agent/pre-step',
      { messages },
      async () => ({ kind: 'enter', messages }),
    );

    assert.equal(result.kind, 'enter');
    assert.deepEqual(result.messages, [keep]);
    assert.strictEqual(result.messages[0], keep);
  } finally {
    await fiber.dispose();
  }
});
