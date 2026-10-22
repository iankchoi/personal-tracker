// This route renders under app/(app)/layout.tsx, which calls `await auth()`
// (cookie-dependent) to build the app shell. With `next.config.ts`'s
// `cacheComponents: true`, any page under a cookie-dependent layout must
// either be wrapped in <Suspense>, use "use cache", or opt out via
// `instant = false`. There's no deferrable secondary content here, so opt
// out entirely — same reasoning Task 7 used for the Settings pages.
export const instant = false;

export default function Home() {
  return (
    <main className="canvas">
      <div className="col1100">
        <h1>Personal Tracker</h1>
      </div>
    </main>
  );
}
