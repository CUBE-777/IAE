/**
 * src/utils/zipBuilder.js
 * كاتب ZIP أدنى بلا مكتبات (طريقة STORE بلا ضغط): ملفات PDF مضغوطة أصلًا فلا فائدة من ضغطها ثانية.
 * منطق خالص يُختبر في Node. أسماء الملفات UTF-8 (علَم bit 11) لتدعم العربية. بلا ZIP64: يرفض تجاوز الحدود صراحةً.
 */
const enc = new TextEncoder();
const MAX_U32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosStamp(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** @returns {{ count: number, add(name: string, bytes: Uint8Array): void, finish(): Uint8Array[], toBlob(): Blob }} */
export function createZip({ now = new Date() } = {}) {
  const parts = [];
  const entries = [];
  const { time, date } = dosStamp(now);
  let offset = 0;

  return {
    get count() { return entries.length; },
    add(name, bytes) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('zip_bad_bytes');
      if (typeof name !== 'string' || !name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('zip_bad_name');
      const nameBytes = enc.encode(name);
      if (nameBytes.length > 0xffff) throw new Error('zip_bad_name');
      if (entries.length + 1 > MAX_ENTRIES) throw new Error('zip_too_many_files');
      if (offset + 30 + nameBytes.length + bytes.length > MAX_U32 - 1024 * 1024) throw new Error('zip_too_large');
      const crc = crc32(bytes);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true); // UTF-8
      head.setUint16(8, 0, true); // STORE
      head.setUint16(10, time, true);
      head.setUint16(12, date, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, bytes.length, true);
      head.setUint32(22, bytes.length, true);
      head.setUint16(26, nameBytes.length, true);
      head.setUint16(28, 0, true);
      parts.push(new Uint8Array(head.buffer), nameBytes, bytes);
      entries.push({ nameBytes, crc, size: bytes.length, offset });
      offset += 30 + nameBytes.length + bytes.length;
    },
    /** أجزاء الملف النهائي بالترتيب (محتوى الملفات نفسه لا يُنسخ) */
    finish() {
      if (!entries.length) throw new Error('zip_empty');
      const out = parts.slice();
      let cdSize = 0;
      for (const e of entries) {
        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true);
        cd.setUint16(4, 20, true);
        cd.setUint16(6, 20, true);
        cd.setUint16(8, 0x0800, true);
        cd.setUint16(10, 0, true);
        cd.setUint16(12, time, true);
        cd.setUint16(14, date, true);
        cd.setUint32(16, e.crc, true);
        cd.setUint32(20, e.size, true);
        cd.setUint32(24, e.size, true);
        cd.setUint16(28, e.nameBytes.length, true);
        cd.setUint32(42, e.offset, true);
        out.push(new Uint8Array(cd.buffer), e.nameBytes);
        cdSize += 46 + e.nameBytes.length;
      }
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, entries.length, true);
      end.setUint16(10, entries.length, true);
      end.setUint32(12, cdSize, true);
      end.setUint32(16, offset, true);
      out.push(new Uint8Array(end.buffer));
      return out;
    },
    toBlob() { return new Blob(this.finish(), { type: 'application/zip' }); },
  };
}
