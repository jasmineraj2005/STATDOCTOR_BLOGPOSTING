"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

const VALID_EMAIL = "anu@statdoctor.au"
const VALID_PASSWORD = "statdoctor@1"

export default function LoginCard() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (email === VALID_EMAIL && password === VALID_PASSWORD) {
      router.push("/dashboard")
    } else {
      setError("Invalid email or password. Please try again.")
    }
  }

  return (
    <div className="w-full max-w-md">
      {/* Frosted glass card */}
      <div
        className="rounded-2xl p-8 shadow-2xl"
        style={{
          background: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255, 255, 255, 0.6)",
        }}
      >
        {/* Heading */}
        <div className="text-center mb-8">
          <h1
            className="text-2xl font-semibold text-gray-600 mb-1 instrument"
            style={{ letterSpacing: "-0.02em" }}
          >
            Welcome back
          </h1>
          <p className="text-sm text-gray-500 font-light">
            Sign in to your account to continue
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-xs font-medium text-gray-700 tracking-wide uppercase"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-2.5 rounded-lg text-sm text-gray-900 placeholder-gray-400 outline-none transition-all duration-200"
              style={{
                background: "rgba(0,0,0,0.04)",
                border: "1px solid rgba(0,0,0,0.10)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.border = "1px solid #8b5cf6"
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139,92,246,0.12)"
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = "1px solid rgba(0,0,0,0.10)"
                e.currentTarget.style.boxShadow = "none"
              }}
            />
          </div>

          {/* Password field */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="password"
                className="text-xs font-medium text-gray-700 tracking-wide uppercase"
              >
                Password
              </label>
              <a
                href="#"
                className="text-xs text-violet-600 hover:text-violet-800 transition-colors duration-150"
              >
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 pr-10 rounded-lg text-sm text-gray-900 placeholder-gray-400 outline-none transition-all duration-200"
                style={{
                  background: "rgba(0,0,0,0.04)",
                  border: "1px solid rgba(0,0,0,0.10)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.border = "1px solid #8b5cf6"
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139,92,246,0.12)"
                }}
                onBlur={(e) => {
                  e.currentTarget.style.border = "1px solid rgba(0,0,0,0.10)"
                  e.currentTarget.style.boxShadow = "none"
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-150"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-xs text-red-500 text-center -mb-1">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="mt-2 w-full py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #8b5cf6, #1e1b4b)" }}
          >
            Sign in
          </button>
        </form>

      </div>
    </div>
  )
}
