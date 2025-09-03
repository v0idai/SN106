import { describe, it } from 'node:test';
import assert from 'assert';

// This is a basic test to ensure the validator can be imported and run

describe('Validator', () => {
  it('should start without throwing', async () => {
    let error = null;
    try {
      await import('../validator/index.js');
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error, null);
  });
}); 