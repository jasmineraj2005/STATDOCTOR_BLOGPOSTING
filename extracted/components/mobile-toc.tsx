"use client"

import type { TocItem } from "@/components/toc-sidebar"

export default function MobileToc({ items }: { items: TocItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="block lg:hidden mb-6">
      <div
        className="rounded-2xl p-5"
        style={{
          background: "#ffffff",
          border: "1px solid hsl(245, 25%, 90%)",
          boxShadow: "0 4px 24px -4px hsl(240 50% 20% / 0.08)",
        }}
      >
        <p
          className="text-xs font-semibold tracking-widest uppercase mb-3"
          style={{
            color: "hsl(240, 55%, 55%)",
            fontFamily: "var(--font-space-grotesk), sans-serif",
          }}
        >
          In This Guide
        </p>
        <nav className="flex flex-col space-y-0.5">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }}
              className="block text-sm py-1.5 leading-snug"
              style={{
                color: "hsl(240, 20%, 46%)",
                fontFamily: "var(--font-montserrat), sans-serif",
              }}
            >
              {item.text}
            </a>
          ))}
        </nav>
      </div>
    </div>
  )
}
