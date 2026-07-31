/**
 * Says plainly when the weekly entries on screen are demo seed data rather than
 * saved ones. Renders nothing once a real entry exists.
 *
 * Imported figures need no equivalent notice: they have no demo mode at all, so
 * a number that is on screen was read out of a file the user uploaded.
 */
export function DemoNotice({ demoEntries }: { demoEntries: boolean }) {
  if (!demoEntries) return null;

  return (
    <div className="prefillNote" style={{ marginBottom: 18 }}>
      <strong>Weekly entries are demo data.</strong> No entries have been saved yet, so
      eight weeks of sample history is shown. Your first save replaces it.
    </div>
  );
}
