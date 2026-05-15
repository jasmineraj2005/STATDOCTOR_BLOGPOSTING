// Stub for 'server-only' in test environments.
// The real package throws to prevent client-side imports in Next.js RSC.
// In vitest (Node), we just export nothing — the guard is not needed.
export {};
