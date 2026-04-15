"use client"

import { useEffect, useState } from "react"

export type TocItem = {
  id: string
  text: string
}

export default function TocSidebar({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "")

  useEffect(() => {
    if (items.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: "-10% 0px -75% 0px", threshold: 0 }
    )

    items.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [items])

  if (items.length === 0) return null

  return (
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
        {items.map((item) => {
          const isActive = activeId === item.id
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
                setActiveId(item.id)
              }}
              className="block text-sm py-1.5 leading-snug transition-all duration-200"
              style={{
                color: isActive ? "hsl(240, 55%, 55%)" : "hsl(240, 20%, 46%)",
                fontWeight: isActive ? 600 : 400,
                paddingLeft: isActive ? "0.5rem" : "0",
                fontFamily: "var(--font-montserrat), sans-serif",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  ;(e.currentTarget as HTMLElement).style.color = "hsl(240, 55%, 55%)"
                  ;(e.currentTarget as HTMLElement).style.paddingLeft = "0.5rem"
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  ;(e.currentTarget as HTMLElement).style.color = "hsl(240, 20%, 46%)"
                  ;(e.currentTarget as HTMLElement).style.paddingLeft = "0"
                }
              }}
            >
              {item.text}
            </a>
          )
        })}
      </nav>
    </div>
  )
}
