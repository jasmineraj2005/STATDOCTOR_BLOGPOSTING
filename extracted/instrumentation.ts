export async function register() {
  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    const msg = typeof args[0] === "string" ? args[0] : ""
    if (msg.includes("backgroundColor") || msg.includes("spotsPerColor")) return
    original(...args)
  }
}
