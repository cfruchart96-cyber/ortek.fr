import './globals.css';
export const metadata = { title: 'Ortek | Portail commercial', robots: 'noindex,nofollow' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="fr"><body><header><strong>ORTEK · Portail commercial</strong><nav><a href="/commercial">Commercial</a><a href="/admin">Administration</a><a href="https://ortek.fr">Site public</a></nav></header><main>{children}</main></body></html>; }
