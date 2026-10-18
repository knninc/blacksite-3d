import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../src/style.css";

export const metadata: Metadata = {
  title: "BLACKSITE 3D — Subject View",
  description:
    "AIサムの一人称で病院を体験する3Dホラー試作。あなたは病院そのものとなり、停電・扉の封鎖・囁き・怪異で脱出を阻む。",
};

export const viewport: Viewport = { themeColor: "#090e0e" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
