import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'RoboHaven — Robotics Club Equipment & Contributions', description: 'A considered workspace for robotics equipment, member contributions, approvals and returns.' };
const seen = "try{if(sessionStorage.getItem('clublend-intro'))document.documentElement.classList.add('seen')}catch(e){}";
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: seen }} /></head>
      <body>
        <div className="intro" aria-hidden="true">
          <i className="half t" /><i className="half b" />
          <div className="intro-core">
            <div className="intro-mark"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#14181c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" /></svg></div>
            <div className="intro-name">RoboHaven</div>
            <div className="intro-bar">{Array.from({ length: 36 }, (_, k) => <b key={k} style={{ ['--k' as string]: k, ['--h' as string]: k % 6 === 0 ? '100%' : k % 3 === 0 ? '62%' : '38%' }} />)}</div>
            <div className="intro-count" />
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
