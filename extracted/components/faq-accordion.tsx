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
          className="rounded-xl overflow-hidden transition-shadow duration-200"
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            boxShadow: open === i ? "0 4px 16px rgba(0,0,0,0.07)" : "none",
          }}
        >
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer group"
          >
            <span className="text-sm font-semibold text-gray-800 pr-4 group-hover:text-violet-700 transition-colors duration-200">
              {item.q}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-violet-500 flex-shrink-0 transition-transform duration-300 ${
                open === i ? "rotate-180" : ""
              }`}
            />
          </button>
          <div
            style={{
              maxHeight: open === i ? "600px" : "0",
              overflow: "hidden",
              transition: "max-height 0.35s ease",
            }}
          >
            <div
              className="px-5 pb-5 pt-3 text-sm text-gray-600 font-light leading-relaxed"
              style={{ borderTop: "1px solid #f3f4f6" }}
            >
              {item.a}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
