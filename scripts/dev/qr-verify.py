"""سكربت تطوير (خارج الحزمة): يفكّ صور QR المولَّدة من src/utils/qr.js بمفكّك مرجعي (OpenCV QRCodeDetector).
الاستعمال:
  node scripts/dev/qr-dump.mjs > /tmp/qr-cases.json
  python3 scripts/dev/qr-verify.py /tmp/qr-cases.json
يخرج برمز 1 إن فشلت أي حالة.
"""
import json
import sys

import cv2
import numpy as np

QUIET = 4
SCALE = 8


def render(rows):
    n = len(rows)
    total = n + QUIET * 2
    img = np.full((total * SCALE, total * SCALE), 255, dtype=np.uint8)
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c == '1':
                img[(y + QUIET) * SCALE:(y + QUIET + 1) * SCALE, (x + QUIET) * SCALE:(x + QUIET + 1) * SCALE] = 0
    return img


def retry(c, img, det):
    """الكاشف في OpenCV يخطئ أحيانًا في تحديد الزوايا لا في الفكّ: نجرّب مقاييس أخرى، ثم الكاشف Aruco، ثم الفكّ بزوايا معلومة."""
    for scale in (0.5, 2, 3):
        im = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        if det.detectAndDecode(im)[0] == c['text']:
            return True
    if hasattr(cv2, 'QRCodeDetectorAruco'):
        if cv2.QRCodeDetectorAruco().detectAndDecode(img)[0] == c['text']:
            return True
    n = len(c['rows'])
    a, b = QUIET * SCALE, (QUIET + n) * SCALE
    corners = np.array([[[a, a], [b, a], [b, b], [a, b]]], dtype=np.float32)
    return det.decode(img, corners)[0] == c['text']


def main(path):
    cases = json.load(open(path, encoding='utf-8'))
    det = cv2.QRCodeDetector()
    fails = []
    by_version = {}
    for c in cases:
        img = render(c['rows'])
        text, pts, _ = det.detectAndDecode(img)
        ok = text == c['text']
        if not ok:
            ok = retry(c, img, det)
        by_version.setdefault(c['version'], [0, 0])[0 if ok else 1] += 1
        if not ok:
            fails.append((c['version'], c['mask'], c['text'][:40], text[:40]))
    for v in sorted(by_version):
        print(f'version {v}: ok={by_version[v][0]} fail={by_version[v][1]}')
    print(f'total={len(cases)} fails={len(fails)}')
    for f in fails[:15]:
        print('FAIL', f)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main(sys.argv[1])
