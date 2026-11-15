import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
// This keeps the security tests independent of the app's package-manager configuration.
const source = await readFile(new URL('../js/vault.js', import.meta.url), 'utf8');
const { Vault, STORAGE_KEY, validateData, emptyData } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

class MemoryStorage {
  values = new Map();
  failWrites = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error('quota');
    this.values.set(key, value);
  }
}

const password = 'a long private password';
const sample = () => ({ version: 1, records: [
  { date: '2024-01-01', weight: 78.2, note: 'private-note-unique' },
  { date: '2024-01-02', weight: 78.1, note: '' },
], goal: 70 });

test('setup encrypts every personal field and a fresh instance unlocks it', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage);
  assert.equal(vault.exists(), false);
  assert.deepEqual(await vault.setup(password, sample()), sample());
  const saved = storage.getItem(STORAGE_KEY);
  for (const secret of [password, '2024-01-01', '78.2', 'private-note-unique', 'records', 'goal']) {
    assert.equal(saved.includes(secret), false, `${secret} must not appear in storage`);
  }
  assert.equal(storage.values.size, 1);
  const fresh = new Vault(storage);
  assert.deepEqual(await fresh.unlock(password), sample());
  await assert.rejects(fresh.setup(password), /이미/);
});

test('wrong password and tampering cannot unlock and preserve stored ciphertext', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage);
  await vault.setup(password, sample());
  const saved = vault.exportEncrypted();
  vault.lock();
  await assert.rejects(vault.unlock('definitely incorrect'), /비밀번호/);
  const tampered = JSON.parse(saved);
  tampered.ciphertext = `${tampered.ciphertext[0] === 'A' ? 'B' : 'A'}${tampered.ciphertext.slice(1)}`;
  await assert.rejects(vault.restore(JSON.stringify(tampered), password), /비밀번호/);
  assert.equal(vault.exportEncrypted(), saved);
  await assert.rejects(vault.save(sample()), /잠겨/);
});

test('save uses fresh IVs, backup restores into another device, and lock blocks writes', async () => {
  const vault = new Vault(new MemoryStorage());
  await vault.setup(password);
  const before = JSON.parse(vault.exportEncrypted());
  await vault.save(sample());
  const backup = vault.exportEncrypted();
  const after = JSON.parse(backup);
  assert.notEqual(before.iv, after.iv);
  assert.equal(before.salt, after.salt);
  assert.deepEqual(vault.inspectBackup(backup), { version: 1, iterations: 310000 });
  const other = new Vault(new MemoryStorage());
  assert.deepEqual(await other.restore(backup, password), sample());
  other.lock();
  assert.equal(other.exportEncrypted(), backup);
  await assert.rejects(other.save(sample()), /잠겨/);
  assert.deepEqual(await other.unlock(password), sample());
});

test('corrupt, malformed and wrong-password backups never overwrite an existing vault', async () => {
  const vault = new Vault(new MemoryStorage());
  await vault.setup(password, sample());
  const original = vault.exportEncrypted();
  for (const backup of ['invalid json', '{}', JSON.stringify({ ...JSON.parse(original), iterations: 1 }),
    JSON.stringify({ ...JSON.parse(original), salt: 'bad' }),
    JSON.stringify({ ...JSON.parse(original), extra: true })]) {
    await assert.rejects(vault.restore(backup, password));
    assert.equal(vault.exportEncrypted(), original);
  }
  await assert.rejects(vault.restore(original, 'incorrect password'));
  assert.equal(vault.exportEncrypted(), original);
});

test('validation rejects impossible or future dates, duplicates and invalid measurements', () => {
  assert.deepEqual(emptyData(), { version: 1, records: [], goal: null });
  const record = { date: '2024-01-01', weight: 78.2, note: '' };
  for (const date of ['2023-02-29', '2024-02-30', '2024-13-01', '0000-01-01', '0001-01-01', '0999-12-31', '9999-01-01']) {
    assert.throws(() => validateData({ version: 1, records: [{ ...record, date }], goal: null }));
  }
  assert.throws(() => validateData({ version: 1, records: [record, { ...record }], goal: null }), /같은 날짜/);
  for (const weight of [19.9, 500.1, 78.23, NaN, Infinity, '78.2']) {
    assert.throws(() => validateData({ version: 1, records: [{ ...record, weight }], goal: null }));
  }
  assert.throws(() => validateData({ version: 1, records: [{ ...record, note: 'x'.repeat(201) }], goal: null }));
  assert.throws(() => validateData({ version: 1, records: [], goal: 0 }));
  assert.deepEqual(validateData({ version: 1, records: [{ ...record, date: '1000-01-01' }], goal: null }).records[0].date, '1000-01-01');
  assert.deepEqual(validateData({ ...sample(), secret: 'drop me' }), sample());
});

test('failed writes keep the last usable snapshot and old records intact', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage);
  await vault.setup(password, sample());
  const original = vault.exportEncrypted();
  storage.failWrites = true;
  await assert.rejects(vault.save(emptyData()), /저장/);
  assert.equal(vault.exportEncrypted(), original);
  storage.failWrites = false;
  await vault.save(emptyData());
  vault.lock();
  assert.deepEqual(await vault.unlock(password), emptyData());
});

test('a stale tab cannot overwrite a newer save', async () => {
  const storage = new MemoryStorage();
  const first = new Vault(storage);
  await first.setup(password);
  const second = new Vault(storage);
  await second.unlock(password);
  await first.save(sample());
  await assert.rejects(second.save(emptyData()), /다른 탭/);
  second.lock();
  assert.deepEqual(await second.unlock(password), sample());
});

test('locking during an asynchronous operation cannot reopen or save the vault', async () => {
  const vault = new Vault(new MemoryStorage());
  await vault.setup(password, sample());
  const before = vault.exportEncrypted();
  const saving = vault.save(emptyData());
  vault.lock();
  await assert.rejects(saving, /잠겨/);
  assert.equal(vault.exportEncrypted(), before);
  const opening = vault.unlock(password);
  vault.lock();
  await assert.rejects(opening, /잠겨/);
  await assert.rejects(vault.save(sample()), /잠겨/);
});
