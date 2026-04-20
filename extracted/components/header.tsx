"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"

export default function Header({ logoHref, light }: { logoHref?: string; light?: boolean }) {
  const logoUrl = logoHref ?? "https://statdoctor.app/"
  const isExternal = !logoHref
  const pathname = usePathname()
  const inDashboard = pathname?.startsWith("/dashboard") ?? false

  return (
    <header
      className="relative z-20 flex items-center justify-between px-4 py-4 sm:px-6 sm:py-5"
      style={
        light
          ? { background: "#ffffff", borderBottom: "1px solid hsl(245, 25%, 91%)" }
          : {}
      }
    >
      {/* SVG Filters — gooey button effect */}
      <svg className="absolute inset-0 w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="glass-effect" x="-50%" y="-50%" width="200%" height="200%">
            <feTurbulence baseFrequency="0.005" numOctaves="1" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.3" />
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0.02
                      0 1 0 0 0.02
                      0 0 1 0 0.05
                      0 0 0 0.9 0"
              result="tint"
            />
          </filter>
          <filter id="gooey-filter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
              result="gooey"
            />
            <feComposite in="SourceGraphic" in2="gooey" operator="atop" />
          </filter>
        </defs>
      </svg>

      {/* Logo */}
      <a
        href={logoUrl}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="flex items-center"
      >
        <Image
          src="/statdoctor-logo.png"
          alt="StatDoctor"
          width={180}
          height={45}
          className="w-28 sm:w-36 md:w-44 xl:w-48"
          style={
            light
              ? {
                  filter:
                    "brightness(0) saturate(100%) invert(26%) sepia(89%) saturate(600%) hue-rotate(237deg) brightness(95%)",
                }
              : { filter: "brightness(0) invert(1)" }
          }
        />
      </a>

      {/* Navigation — only in dashboard section */}
      <nav className="flex items-center gap-1">
        {inDashboard && (
          <>
            <NavLink
              href="/dashboard"
              active={pathname === "/dashboard" || pathname?.startsWith("/dashboard/posts")}
              light={light}
            >
              Posts
            </NavLink>
            <NavLink href="/dashboard/analytics" active={pathname === "/dashboard/analytics"} light={light}>
              Analytics
            </NavLink>
          </>
        )}
      </nav>

      {/* Login Button */}
      <Link
        href="/login"
        id="gooey-btn"
        className="relative flex items-center group"
        style={{ filter: "url(#gooey-filter)" }}
      >
        {light ? (
          <>
            <button
              className="absolute right-0 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-full font-normal text-xs sm:text-sm transition-all duration-300 cursor-pointer h-8 sm:h-11 flex items-center justify-center -translate-x-10 sm:-translate-x-12 group-hover:-translate-x-19 sm:group-hover:-translate-x-22 z-0"
              style={{ background: "hsl(250, 50%, 50%)", color: "#ffffff" }}
            >
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </button>
            <button
              className="px-5 py-2 sm:px-8 sm:py-2.5 rounded-full font-normal text-xs sm:text-sm transition-all duration-300 cursor-pointer h-8 sm:h-11 flex items-center z-10"
              style={{ background: "hsl(250, 50%, 50%)", color: "#ffffff" }}
            >
              Login
            </button>
          </>
        ) : (
          <>
            <button className="absolute right-0 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-full bg-white text-black font-normal text-xs sm:text-sm transition-all duration-300 hover:bg-white/90 cursor-pointer h-8 sm:h-11 flex items-center justify-center -translate-x-10 sm:-translate-x-12 group-hover:-translate-x-19 sm:group-hover:-translate-x-22 z-0">
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </button>
            <button className="px-5 py-2 sm:px-8 sm:py-2.5 rounded-full bg-white text-black font-normal text-xs sm:text-sm transition-all duration-300 hover:bg-white/90 cursor-pointer h-8 sm:h-11 flex items-center z-10">
              Login
            </button>
          </>
        )}
      </Link>
    </header>
  )
}

function NavLink({
  href,
  active,
  light,
  children,
}: {
  href: string
  active: boolean
  light?: boolean
  children: React.ReactNode
}) {
  if (light) {
    return (
      <Link
        href={href}
        className={`px-4 py-2 text-sm font-light rounded-full transition-colors duration-200 ${
          active ? "bg-purple-100 border border-purple-200" : "hover:bg-purple-50"
        }`}
        style={{ color: active ? "hsl(250, 50%, 45%)" : "hsl(240, 20%, 46%)" }}
      >
        {children}
      </Link>
    )
  }
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm font-light rounded-full transition-colors duration-200 ${
        active
          ? "text-white bg-white/10 border border-white/20"
          : "text-white/60 hover:text-white/90 hover:bg-white/5"
      }`}
    >
      {children}
    </Link>
  )
}
