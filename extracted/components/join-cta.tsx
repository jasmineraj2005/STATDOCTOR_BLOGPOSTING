export default function JoinCTA() {
  return (
    <section className="post-cta-section">
      <h3>Join Australia&apos;s Fastest Growing Locum Network</h3>
      <p>
        StatDoctor connects hospitals and clinics with verified locum doctors across Australia.
        Streamlined onboarding, instant bookings, and transparent rates — no middlemen.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap", marginTop: "1.75rem" }}>
        <a
          href="https://statdoctor.app"
          target="_blank"
          rel="noopener noreferrer"
          className="post-cta-btn"
        >
          I&apos;m a Doctor — Find Shifts
        </a>
        <a
          href="https://statdoctor.app"
          target="_blank"
          rel="noopener noreferrer"
          className="post-cta-btn post-cta-btn-outline"
        >
          I Need Locum Doctors
        </a>
      </div>
      <p className="post-cta-tagline">Free to sign up · No agency fees · Instant matching</p>
    </section>
  )
}
