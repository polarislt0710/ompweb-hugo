import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Noto_Sans_Mono, Noto_Serif_SC, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jb-mono",
  display: "swap",
});

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

// Display serif pair for the warm-humanistic heading voice: Source Serif 4
// covers latin, Noto Serif SC covers CJK. Both expose CSS variables consumed
// by --font-serif in globals.css.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

const notoSerifSC = Noto_Serif_SC({
  // CJK glyphs are served via unicode-range slices regardless of subset;
  // "latin" satisfies next/font's preloading requirement.
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-noto-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "omp web",
  description: "Web UI for the oh-my-pi (omp) coding agent",
  // PWA-like behavior on iOS: standalone chrome, no telephone autodetect.
  appleWebApp: {
    capable: true,
    title: "omp web",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

// theme-color adapts to light/dark so the browser chrome / iOS status bar
// matches the active theme. `viewportFit: cover` lets us honor safe-area-inset
// (used by DirectoryPicker footer) on notched devices.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F6" },
    { media: "(prefers-color-scheme: dark)", color: "#1B1916" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${geist.variable} ${jetbrainsMono.variable} ${notoSansMono.variable} ${sourceSerif.variable} ${notoSerifSC.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        {/* Pre-hydration: apply stored theme before first paint to avoid a flash
            of the wrong theme. Matches html.dark / html.omp selectors in globals.css. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("omp-theme"),d=matchMedia("(prefers-color-scheme: dark)").matches;var dt={"dark":1,"omp":1,"dracula":1,"harbor":1,"one-dark-pro":1,"rose-pine":1,"catppuccin-mocha":1,"gruvbox-dark":1,"nord":1,"tokyo-night":1,"oled":1,"pine":1,"navy":1,"codex":1,"aurora-flow":1,"dawn-flow":1,"cosmic-flow":1,"ocean-flow":1,"sakura-flow":1,"bamboo-flow":1};var lt={"light":1,"one-light":1,"catppuccin-latte":1,"rose-pine-dawn":1,"oatmeal":1,"matcha":1,"sepia":1};if(t==="custom"){document.documentElement.setAttribute("data-theme","custom");try{var c=JSON.parse(localStorage.getItem("omp-custom-theme")||"{}");if(c.isDark)document.documentElement.classList.add("dark")}catch(e2){}return}var res=t==="system"?(d?"dark":"light"):(!t?"omp":t);if(!dt[res]&&!lt[res]&&res!=="omp")res="omp";var dark=!!dt[res]&&res!=="omp";if(dark)document.documentElement.classList.add("dark");if(res==="omp"){document.documentElement.classList.add("omp")}else{document.documentElement.classList.add("theme-"+res)}document.documentElement.setAttribute("data-theme",res);if(String(res).slice(-5)==="-flow")document.documentElement.classList.add("theme-flow-active")}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k="omp-lang";var m="omp-lang-zh-tw-default";var l=localStorage.getItem(k);if(l==="zh-CN"&&localStorage.getItem(m)!=="1"){localStorage.setItem(m,"1");l="zh-TW";localStorage.setItem(k,l)}var ok={"en":1,"zh-CN":1,"zh-TW":1,"ja":1};if(!ok[l]){try{localStorage.setItem(m,"1")}catch(e2){}var n=(navigator.language||"").toLowerCase();if(n.indexOf("zh-cn")===0||n.indexOf("zh-hans")===0||n.indexOf("zh-sg")===0)l="zh-CN";else if(n.indexOf("zh")===0)l="zh-TW";else if(n.indexOf("ja")===0)l="ja";else l="zh-TW"}document.documentElement.lang=l}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var f=localStorage.getItem("omp-font-size");if(f==="sm"||f==="md"||f==="lg"||f==="xl")document.documentElement.setAttribute("data-font-size",f)}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("omp-ui-scale");if(s==="compact"||s==="standard"||s==="comfortable"||s==="large")document.documentElement.setAttribute("data-ui-scale",s)}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100%", maxHeight: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
