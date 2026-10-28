import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isValidEmail,
  normalizeEmail,
  validateEmail,
  validateName,
  validatePassword,
} from './authValidation';

describe('auth validation', () => {
  it('normalises email addresses for storage and lookup', () => {
    assert.equal(normalizeEmail('  Sam@Example.COM '), 'sam@example.com');
  });

  it('accepts ordinary email addresses', () => {
    assert.equal(isValidEmail('sam@example.com'), true);
    assert.equal(validateEmail('sam@example.com'), null);
  });

  it('rejects malformed and oversized email addresses', () => {
    assert.equal(isValidEmail('sam@example'), false);
    assert.equal(isValidEmail('sam @example.com'), false);
    assert.equal(validateEmail(''), 'Please enter your email address.');
    assert.ok(validateEmail(`${'a'.repeat(250)}@example.com`));
  });

  it('enforces the name length range', () => {
    assert.equal(validateName('Sam'), null);
    assert.equal(validateName('S'), 'Name must be at least 2 characters.');
    assert.ok(validateName('a'.repeat(81)));
  });

  it('requires a password of at least eight characters', () => {
    assert.equal(validatePassword('longenough'), null);
    assert.equal(validatePassword('short'), 'Password must be at least 8 characters.');
    assert.equal(validatePassword(''), 'Please enter a password.');
    assert.ok(validatePassword('a'.repeat(129)));
  });
});
