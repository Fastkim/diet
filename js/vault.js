// The public site ships only this code. Personal data stays encrypted in this browser.
export const STORAGE_KEY = 'haru-weight-vault-v1';

const ITERATIONS = 310_000;
const MAX_ITERATIONS = 2_000_000;
const MAX_BACKUP_LENGTH = 32 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const authenticatedHeader = encoder.encode('haru-weight-vault:v1');
const BACKUP_ERROR = '올바른 암호화 백업 파일이 아닙니다.';
const STORAGE_ERROR = '브라우저에 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해 주세요.';
const LOCKED_ERROR = '보관함이 잠겨 있습니다. 비밀번호로 다시 열어 주세요.';

function cryptoApi() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('암호화를 사용할 수 없습니다. HTTPS 또는 localhost로 접속해 주세요.');
  }
  return globalThis.crypto;
}

function bytesToBase64(bytes) {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(result);
}

function base64ToBytes(value, expectedLength) {
  if (typeof value !== 'string' || value.length > MAX_BACKUP_LENGTH ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(BACKUP_ERROR);
  }
  const decoded = atob(value);
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(BACKUP_ERROR);
  }
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  // Reject noncanonical encodings rather than accepting ambiguous backup contents.
  if (bytesToBase64(bytes) !== value) throw new Error(BACKUP_ERROR);
  return bytes;
}

function parseEnvelope(json) {
  try {
    if (typeof json !== 'string' || json.length > MAX_BACKUP_LENGTH) throw new Error();
    const value = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const fields = ['version', 'kdf', 'hash', 'iterations', 'cipher', 'salt', 'iv', 'ciphertext'];
    if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
      throw new Error();
    }
    if (value.version !== 1 || value.kdf !== 'PBKDF2' || value.hash !== 'SHA-256' ||
        value.cipher !== 'AES-GCM' || !Number.isInteger(value.iterations) ||
        value.iterations < ITERATIONS || value.iterations > MAX_ITERATIONS) throw new Error();
    const salt = base64ToBytes(value.salt, 16);
    const iv = base64ToBytes(value.iv, 12);
    const ciphertext = base64ToBytes(value.ciphertext);
    if (ciphertext.length < 17) throw new Error();
    return { value, salt, iv, ciphertext };
  } catch {
    throw new Error(BACKUP_ERROR);
  }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    throw new Error('비밀번호는 10자 이상 128자 이하로 입력해 주세요.');
  }
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function validWeight(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 500 &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
}

export function emptyData() {
  return { version: 1, records: [], goal: null };
}

// Return only supported fields, never retain imported object references.
export function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 ||
      !Array.isArray(data.records) || data.records.length > MAX_RECORDS ||
      (data.goal !== null && !validWeight(data.goal))) {
    throw new Error('기록 데이터 형식이 올바르지 않습니다.');
  }
  const today = localToday();
  const dates = new Set();
  const records = data.records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
        record.date < '1000-01-01' || record.date > today || !validWeight(record.weight) ||
        (record.note !== undefined && (typeof record.note !== 'string' || record.note.length > 200))) {
      throw new Error('기록의 날짜, 체중 또는 메모를 확인해 주세요.');
    }
    const parsedDate = new Date(`${record.date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== record.date) {
      throw new Error('실제 존재하는 날짜를 입력해 주세요.');
    }
    if (dates.has(record.date)) throw new Error('같은 날짜의 기록은 하나만 저장할 수 있습니다.');
    dates.add(record.date);
    return { date: record.date, weight: Math.round(record.weight * 10) / 10, note: record.note ?? '' };
  });
  records.sort((first, second) => first.date.localeCompare(second.date));
  return { version: 1, records, goal: data.goal === null ? null : Math.round(data.goal * 10) / 10 };
}

async function deriveKey(password, salt, iterations) {
  const crypto = cryptoApi();
  const raw = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    raw.fill(0);
  }
}

async function encryptData(key, salt, iterations, data) {
  const crypto = cryptoApi();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(data));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: authenticatedHeader, tagLength: 128 }, key, plaintext,
    );
    const result = JSON.stringify({
      version: 1, kdf: 'PBKDF2', hash: 'SHA-256', iterations, cipher: 'AES-GCM',
      salt: bytesToBase64(salt), iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    });
    if (result.length > MAX_BACKUP_LENGTH) throw new Error('저장할 기록의 크기가 너무 큽니다.');
    return result;
  } finally {
    plaintext.fill(0);
  }
}

async function decryptEnvelope(envelope, password) {
  validatePassword(password);
  const key = await deriveKey(password, envelope.salt, envelope.value.iterations);
  let plaintext;
  try {
    plaintext = new Uint8Array(await cryptoApi().subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.iv, additionalData: authenticatedHeader, tagLength: 128 },
      key, envelope.ciphertext,
    ));
  } catch {
    throw new Error('비밀번호가 다르거나 백업 파일이 손상되었습니다.');
  }
  try {
    return { key, data: validateData(JSON.parse(decoder.decode(plaintext))) };
  } catch {
    throw new Error('백업 안의 기록 데이터가 올바르지 않습니다.');
  } finally {
    plaintext.fill(0);
  }
}

export class Vault {
  #storage;
  #key = null;
  #salt = null;
  #iterations = ITERATIONS;
  #snapshot = null;
  #generation = 0;

  constructor(storage = globalThis.localStorage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error(STORAGE_ERROR);
    }
    this.#storage = storage;
  }

  #read() {
    try { return this.#storage.getItem(STORAGE_KEY); }
    catch { throw new Error(STORAGE_ERROR); }
  }

  #write(json) {
    try { this.#storage.setItem(STORAGE_KEY, json); }
    catch { throw new Error(STORAGE_ERROR); }
  }

  #assertGeneration(generation) {
    if (generation !== this.#generation) throw new Error(LOCKED_ERROR);
  }

  #accept(key, envelope, snapshot) {
    this.#key = key;
    this.#salt = envelope.salt;
    this.#iterations = envelope.value.iterations;
    this.#snapshot = snapshot;
  }

  exists() {
    return this.#read() !== null;
  }

  async setup(password, initialData = emptyData()) {
    if (this.exists()) throw new Error('이미 보관함이 있습니다. 비밀번호로 열어 주세요.');
    validatePassword(password);
    const data = validateData(initialData);
    const generation = this.#generation;
    const salt = cryptoApi().getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt, ITERATIONS);
    const json = await encryptData(key, salt, ITERATIONS, data);
    this.#assertGeneration(generation);
    if (this.exists()) throw new Error('다른 탭에서 보관함을 만들었습니다. 다시 열어 주세요.');
    this.#write(json);
    this.#accept(key, parseEnvelope(json), json);
    return data;
  }

  async unlock(password) {
    const json = this.#read();
    if (json === null) throw new Error('저장된 보관함이 없습니다. 새 보관함을 만들어 주세요.');
    const generation = this.#generation;
    const envelope = parseEnvelope(json);
    const { key, data } = await decryptEnvelope(envelope, password);
    this.#assertGeneration(generation);
    if (this.#read() !== json) throw new Error('다른 탭에서 기록이 바뀌었습니다. 다시 열어 주세요.');
    this.#accept(key, envelope, json);
    return data;
  }

  async save(input) {
    if (!this.#key) throw new Error(LOCKED_ERROR);
    const generation = this.#generation;
    const snapshot = this.#snapshot;
    if (this.#read() !== snapshot) {
      this.lock();
      throw new Error('다른 탭에서 기록이 바뀌었습니다. 보관함을 다시 열어 주세요.');
    }
    const data = validateData(input);
    const json = await encryptData(this.#key, this.#salt, this.#iterations, data);
    this.#assertGeneration(generation);
    if (this.#read() !== snapshot) {
      this.lock();
      throw new Error('다른 탭에서 기록이 바뀌었습니다. 보관함을 다시 열어 주세요.');
    }
    this.#write(json);
    this.#snapshot = json;
    return data;
  }

  lock() {
    this.#generation += 1;
    this.#key = null;
    this.#salt = null;
    this.#snapshot = null;
  }

  exportEncrypted() {
    const json = this.#read();
    if (json === null) throw new Error('백업할 보관함이 없습니다.');
    parseEnvelope(json);
    return json;
  }

  inspectBackup(json) {
    const { value } = parseEnvelope(json);
    return { version: value.version, iterations: value.iterations };
  }

  async restore(json, password) {
    const generation = this.#generation;
    const snapshot = this.#read();
    const envelope = parseEnvelope(json);
    const { key, data } = await decryptEnvelope(envelope, password);
    this.#assertGeneration(generation);
    if (this.#read() !== snapshot) {
      throw new Error('다른 탭에서 기록이 바뀌었습니다. 새로 고친 후 복원해 주세요.');
    }
    // Parsing, password verification and full record validation precede this atomic write.
    const canonical = JSON.stringify(envelope.value);
    this.#write(canonical);
    this.#accept(key, envelope, canonical);
    return data;
  }
}
