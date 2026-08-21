import type { Metadata } from 'next';
import './globals.css';
import { Topbar } from '@/components/Topbar';

export const metadata: Metadata = {
  title: 'amber Communities · Weekly engagement report',
  description:
    'Weekly engagement report across amber’s WhatsApp communities — three five-group ' +
    'communities (UK, USA, Australia, Canada, Germany each) plus a combined landing page & WADL view.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skipLink" href="#main">
          Skip to content
        </a>
        <div className="shell">
          <Topbar />
          <div className="main" id="main">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
