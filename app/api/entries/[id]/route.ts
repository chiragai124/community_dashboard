import { NextResponse } from 'next/server';
import { deleteEntry } from '@/lib/store';

/** DELETE /api/entries/:id — remove one stored week (id is `group:weekStart`). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const removed = await deleteEntry(decodeURIComponent(id));
    if (!removed) {
      return NextResponse.json({ error: `No entry with id ${id}.` }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete entry.' },
      { status: 500 },
    );
  }
}
