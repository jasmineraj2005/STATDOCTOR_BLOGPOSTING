"use client"

import { useEffect } from "react"

export function SuppressWarnings() {
  useEffect(() => {
    const original = console.error.bind(console)
    console.error = (...args: unknown[]) => {
      const msg = typeof args[0] === "string" ? args[0] : ""
      if (
        msg.includes("backgroundColor") ||
        msg.includes("spotsPerColor")
      ) return
      original(...args)
    }
    return () => {
      console.error = original
    }
  }, [])
  return null
}
