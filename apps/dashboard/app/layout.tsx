import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Webhooks",
  description: "Send, watch and fix your webhooks",
};

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const themeScript =
  'try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
