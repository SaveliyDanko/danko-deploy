import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // рекомендованная длина nonce для GCM

/**
 * Декодирует мастер-ключ из env (base64, 32 байта).
 * Бросает понятную ошибку, если ключ отсутствует или неверной длины —
 * без него нельзя ни шифровать, ни расшифровать SSH-секреты.
 */
export function loadMasterKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error(
      "DANKODEPLOY_MASTER_KEY не задан. Сгенерируйте: " +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("DANKODEPLOY_MASTER_KEY должен быть 32 байта в base64 (256 бит)");
  }
  return key;
}

/**
 * Шифрует строку AES-256-GCM. Формат результата: base64(iv):base64(tag):base64(cipher).
 */
export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/** Расшифровывает строку, созданную encryptSecret. */
export function decryptSecret(payload: string, masterKey: Buffer): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Повреждённый формат зашифрованного секрета");
  }
  const decipher = createDecipheriv(ALGO, masterKey, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Хэширование пароля для аутентификации панели (scrypt).
// Хранится в env DANKODEPLOY_AUTH_PASSWORD_HASH в формате "salt:hash" (hex).
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

/** Хэширует пароль scrypt'ом со случайной солью. Результат: "salt:hash" (hex). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Проверяет пароль против хранимого "salt:hash". Сравнение timing-safe.
 * Возвращает false при любом нарушении формата (а не бросает) — удобно для guard.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plain, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Выводит 32-байтный AES-ключ из пользовательского пароля (scrypt + соль).
 * Используется для экспорта/импорта конфигурации: секреты перешифровываются под
 * этот ключ, чтобы бэкап-файл можно было перенести на другую машину/master-key.
 */
export function deriveKeyFromPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}
