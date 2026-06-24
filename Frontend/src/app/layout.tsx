import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StratOS — Cognitive Digital Twin",
  description: "Autonomous Strategic Planning for University C-Suite Executives",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-[#080a14] antialiased">
        {/* Runs before React hydrates — prevents flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('stratos-theme');if(t==='light'){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');}}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
