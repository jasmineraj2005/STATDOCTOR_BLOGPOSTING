"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

export type FaqItem = { q: string; a: string }

export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null)

  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-2xl overflow-hidden transition-all duration-300"
          style={{
            background: "#ffffff",
            border: "1px solid hsl(245, 25%, 90%)",
            boxShadow: "0 4px 24px -4px hsl(240 50% 20% / 0.08)",
            fontFamily: "var(--font-montserrat), sans-serif",
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLElement).style.boxShadow =
              "0 8px 40px -8px hsl(240 50% 20% / 0.15)"
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.boxShadow =
              "0 4px 24px -4px hsl(240 50% 20% / 0.08)"
          }}
        >
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between p-4 text-left cursor-pointer transition-colors duration-200"
            style={{ background: "transparent" }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.background =
                "hsl(245, 25%, 93% / 0.5)"
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.background = "transparent"
            }}
          >
            <span
              className="text-sm font-medium pr-4"
              style={{ color: "hsl(240, 50%, 20%)" }}
            >
              {item.q}
            </span>
            <ChevronDown
              className="w-5 h-5 flex-shrink-0 transition-all duration-300"
              style={{
                color: open === i ? "hsl(240, 55%, 55%)" : "hsl(240, 20%, 46%)",
                transform: open === i ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </button>
          <div
            style={{
              maxHeight: open === i ? "600px" : "0",
              opacity: open === i ? 1 : 0,
              overflow: "hidden",
              transition: "max-height 0.25s ease, opacity 0.25s ease",
            }}
          >
            <div
              className="px-4 pb-4 pt-3 text-sm leading-relaxed"
              style={{
                color: "hsl(240, 20%, 46%)",
                borderTop: "1px solid hsl(245, 25%, 90%)",
              }}
            >
              {item.a}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
