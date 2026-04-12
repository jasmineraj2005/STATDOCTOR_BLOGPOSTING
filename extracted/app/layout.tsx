import type React from "react"
import type { Metadata } from "next"
import { Figtree } from "next/font/google"
import { GeistMono } from "geist/font/mono"
import { Instrument_Serif } from "next/font/google"
import "./globals.css"

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
})

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
})

export const metadata: Metadata = {
  title: "v0 App",
  description: "Created with v0",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var SUPPRESS=['backgroundColor','spotsPerColor'];
  function patch(fn){return function(){var m=String(arguments[0]||'');for(var i=0;i<SUPPRESS.length;i++){if(m.includes(SUPPRESS[i]))return;}fn.apply(console,arguments);};}
  console.error=patch(console.error.bind(console));
  console.warn=patch(console.warn.bind(console));

  // Remove Next.js dev overlay entirely
  if(typeof MutationObserver!=='undefined'){
    var obs=new MutationObserver(function(mutations){
      mutations.forEach(function(m){
        m.addedNodes.forEach(function(node){
          if(node.nodeName&&node.nodeName.toLowerCase()==='nextjs-portal'){
            node.parentNode&&node.parentNode.removeChild(node);
          }
        });
      });
    });
    document.addEventListener('DOMContentLoaded',function(){
      obs.observe(document.body,{childList:true,subtree:true});
      // Remove any already-present portal
      var existing=document.querySelector('nextjs-portal');
      if(existing)existing.parentNode&&existing.parentNode.removeChild(existing);
    });
  }
})();
        `}} />
        <style>{`
html {
  font-family: ${figtree.style.fontFamily};
  --font-sans: ${figtree.variable};
  --font-mono: ${GeistMono.variable};
  --font-instrument-serif: ${instrumentSerif.variable};
}
        `}</style>
      </head>
      <body className={`${figtree.variable} ${instrumentSerif.variable}`}>
        {children}
      </body>
    </html>
  )
}
