/**
 * Firestore Security Rules Verification Spec (Dirty Dozen Payloads)
 * Verifies that all 12 adversarial payloads are rejected with PERMISSION_DENIED.
 */

export const DIRTY_DOZEN_TEST_CASES = [
  {
    name: '1. Shadow field injection on /appState/global',
    path: 'appState/global',
    op: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '2. Invalid stateId path poisoning (/appState/other)',
    path: 'appState/other',
    op: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '3. Unauthorized write with invalid adminProof digest',
    path: 'appState/global',
    op: 'update',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '4. Unbounded announcements map (> 100 entries)',
    path: 'appState/global',
    op: 'update',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '5. Unbounded materials map (> 500 entries)',
    path: 'appState/global',
    op: 'update',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '6. Malformed passwordHash string',
    path: 'appState/global',
    op: 'update',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '7. Unverified admin email spoof',
    path: 'appState/global',
    op: 'update',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '8. Invalid cloudKey path on /studentPrefs/short_key',
    path: 'studentPrefs/short_key',
    op: 'get',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '9. Invalid enum value on StudentPreference.otherGroupMode',
    path: 'studentPrefs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    op: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '10. Collection list scraping on /studentPrefs',
    path: 'studentPrefs',
    op: 'list',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '11. Oversized PDF chunk (> 900KB)',
    path: 'pdfChunks/mat_1_chunk_0',
    op: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '12. Type poisoning on requireStudentLogin',
    path: 'appState/global',
    op: 'update',
    expected: 'PERMISSION_DENIED',
  },
];
