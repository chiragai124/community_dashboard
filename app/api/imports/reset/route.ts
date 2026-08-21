import { NextResponse } from 'next/server';
import { resetImports } from '@/lib/imports';

/**
 * POST /api/imports/reset — unconditionally wipe every uploaded file's
 * figures (Short.io, GA4 and WhatsApp alike).
 *
 * Irreversible — the client is expected to confirm with the user before
 * calling it. Separate from /api/entries/reset since imports and manual
 * entries are two independent stores.
 */
export async function POST() {
  try {
    const result = await resetImports();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reset imports.' },
      { status: 500 },
    );
  }
}
