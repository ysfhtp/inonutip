# Security Specification — Quota-Friendly Single Document Architecture

## 1. Data Invariants
1. **Single Global State Document (`/appState/{stateId}`)**:
   - Only `stateId == 'global'` is permitted.
   - All reads are single-document `get` operations (`allow list: if false;`), eliminating collection scan read amplification.
   - Writes (`create`, `update`) require either verified admin Google authentication (`ysfhtp6@gmail.com` with `email_verified == true`) OR a valid 64-character hex `adminProof` whose SHA-256 base64 digest matches the active `proofDigestB64` (or default proof digest `NYixg8m6D55ww5bflL1j5si5a9Yb3lurTyAKeAOKDEs=`).
   - All fields (`requireStudentLogin`, `accessUpdatedAtMs`, `passwordHash`, `proofDigestB64`, `wrappedRosterKey`, `announcements`, `materials`, `customStudents`, `directory`, `updatedAtMs`, `adminProof`) must strictly adhere to schema types and size bounds.
2. **Student Preferences (`/studentPrefs/{cloudKey}`)**:
   - `cloudKey` must be a 64-character lowercase hexadecimal HMAC/SHA-256 key (`^[a-f0-9]{64}$`).
   - Only `get`, `create`, and `update` on a known 64-character hex `cloudKey` are permitted (`allow list: if false;`, `allow delete: if false;`).
   - Strict enum and length validation on `myMbuGroup`, `myLabGroup`, `otherGroupMode`, `lang`, `authHash`, `last4`, and `updatedAtMs`.
3. **PDF Chunks (`/pdfChunks/{chunkDocId}`)**:
   - `chunkDocId` must match `^[a-zA-Z0-9_-]{1,128}$`.
   - Only `get`, `create`, `update`, and `delete` by exact ID are allowed (`allow list: if false;`).
   - Creating or updating requires a valid 64-char hex `adminProof` and strict size bounds (`data.size() <= 900000`).

## 2. The "Dirty Dozen" Payloads
1. **Shadow Field Injection on `/appState/global`**: Adding `"isSuperAdmin": true` -> Rejected by `hasOnly()`.
2. **Invalid `stateId` Path Poisoning**: Writing to `/appState/malicious_doc` -> Rejected by `stateId == 'global'`.
3. **Unauthorized Write without Valid `adminProof`**: Writing to `/appState/global` with `"adminProof": "0000..."` -> Rejected by cryptographic SHA-256 digest check.
4. **Unbounded Map Poisoning on `announcements`**: Map with `size() > 100` -> Rejected by `data.announcements.size() <= 100`.
5. **Unbounded Map Poisoning on `materials`**: Map with `size() > 500` -> Rejected by `data.materials.size() <= 500`.
6. **Malformed `passwordHash`**: Non-hex or wrong length string -> Rejected by `matches('^[a-f0-9]{64}$')`.
7. **Unverified Admin Email Spoof**: Token with `email == 'ysfhtp6@gmail.com'` but `email_verified == false` -> Rejected by `request.auth.token.email_verified == true`.
8. **Invalid `cloudKey` on `/studentPrefs/{cloudKey}`**: Path with 10 characters instead of 64 hex chars -> Rejected by `isValidHex64(cloudKey)`.
9. **Invalid Enum on `StudentPreference`**: Setting `otherGroupMode: "destroy"` -> Rejected by `in ['dim', 'hide']`.
10. **Collection List Scraping on `/studentPrefs`**: Calling `getDocs(collection(db, 'studentPrefs'))` -> Rejected because `allow list` is denied.
11. **Oversized PDF Chunk (`> 900KB`)**: Uploading 1MB string to `/pdfChunks/c1` -> Rejected by `data.data.size() <= 900000`.
12. **Type Poisoning on `requireStudentLogin`**: Sending string `"true"` instead of boolean `true` -> Rejected by `data.requireStudentLogin is bool`.
