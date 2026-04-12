"use client"

import ShaderBackground from "@/components/shader-background"
import Header from "@/components/header"
import LoginCard from "@/components/login-card"

export default function LoginPage() {
  return (
    <ShaderBackground>
      <Header logoHref="/" />
      <main className="absolute inset-0 z-10 flex items-center justify-center px-4">
        <LoginCard />
      </main>
    </ShaderBackground>
  )
}
