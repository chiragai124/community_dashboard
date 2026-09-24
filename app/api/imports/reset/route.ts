import { NextResponse } from 'next/server';
import { resetImports } from '@/lib/imports';
import { refreshAllReports } from '@/lib/dashboard';

/**
 * POST /api/imports/reset — unconditionally wipe every uploaded file's
 * figures (Short.io, GA4 and WhatsApp alike).
 *
 * The filed reports are then refreshed rather than left alone. Their stored
 * numbers are a snapshot of the imports, so skipping this would leave every
 * past report still showing message counts and traffic figures whose source
 * data no longer exists — a reset that visibly reset nothing. Hand-entered
 * figures (member totals, leads, the Instagram channel) are a separate store
 * and survive, so the reports keep those.
 *
 * Irreversible — the client is expected to confirm with the user before
 * calling it.
 */
export async function POST() {
  try {
    const result = await resetImports();
    const reportsRefreshed = await refreshAllReports();
    return NextResponse.json({ ...result, reportsRefreshed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reset imports.' },
      { status: 500 },
    );
  }
}
