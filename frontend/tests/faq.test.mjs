import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findAnswer } from '../src/services/faqSearch.js';

const { faq } = JSON.parse(await readFile(new URL('../src/data/faq.json', import.meta.url), 'utf8'));
const ask = q => findAnswer(faq, q);

test('the FAQ list holds only public answers', () => {
  assert.ok(faq.length >= 200);
  for (const e of faq) assert.ok(e.q && e.a, 'every entry has a question and an answer');
  assert.ok(!faq.some(e => /admin security section|Accept & Continue during signup/i.test(e.q)), 'planned security and admin answers stay out');
});
test('common questions find their answer, however they are worded', () => {
  const cases = {
    'how many sheets are free': 'How many worksheets are free?',
    'can I get a refund': 'Can I get a refund?',
    'how do I sign up': 'How do I create an account?',
    'I forgot my password': 'I forgot my password. How can I reset it?',
    'where are my worksheets': 'Where can I find my worksheets?',
    'money deducted but no sheet': 'Money was deducted but the worksheet is locked. What should I do?',
    'missing letters sheet': 'What are missing-letter activities?',
    'colours and shapes': 'What is in Vocabulary?',
    'hello': 'Hello!',
  };
  for (const [q, want] of Object.entries(cases)) assert.equal(ask(q).question, want, q);
});
test('a question about one letter gets that letter, not another', () => {
  assert.equal(ask('colour the letter C').question, 'What is Colour the letter C?');
  assert.equal(ask('tell me about alphabet Q tracing').question, 'What is Alphabet Q — tracing sheet?');
});
test('free answers match the site: eight free sheets', () => {
  assert.match(ask('which sheets are free').answer, /Free sheets to try in every section/);
});
test('an unrelated or unclear question gets no made-up answer', () => {
  assert.equal(ask('what is the weather today').answer, null);
  const r = ask('delete my account');
  assert.equal(r.answer, null);
  assert.ok(r.suggestions.length > 0, 'closest questions are offered instead');
});
