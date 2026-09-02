/**
 * Test stub for the `server-only` marker package.
 *
 * The real package throws unless the `react-server` export condition is
 * active, which is not the case under Vitest. The guard still applies to the
 * Next.js build, where it is what actually matters: it fails the build if a
 * client component imports server code.
 */
export {};
