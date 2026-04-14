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
        background: "rgba(255, 255, 255, 0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      <p className="text-[10px] font-medium tracking-widest uppercase text-violet-400 mb-4">
        In This Guide
      </p>
      <nav className="flex flex-col">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              setActiveId(item.id)
            }}
            className={`text-sm py-1.5 pl-3 leading-snug transition-all duration-200 border-l-2 ${
              activeId === item.id
                ? "text-violet-300 border-violet-500 font-medium"
                : "text-white/40 border-white/10 hover:text-white/75 hover:border-violet-400/50"
            }`}
          >
            {item.text}
          </a>
        ))}
      </nav>
    </div>
  )
}
