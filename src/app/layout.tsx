import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "خادم MCP لتوليد الوسائط",
  description:
    "خادم MCP واحد يجمع توليد الصور والفيديو ودمج المقاطع في أداة واحدة. يدعم ChatGPT Connectors و Claude Desktop و Cursor و Windsurf و Cline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
